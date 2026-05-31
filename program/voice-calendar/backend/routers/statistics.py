from collections import Counter
from datetime import datetime, timedelta, timezone

from flask import Blueprint, request

from models import Event, VoiceLog
from response import error_response, ok_response

# 关键词匹配顺序即优先级，先匹配到的分类优先
_CATEGORY_RULES: list[tuple[str, list[str]]] = [
    ("学习", ["学习", "读书", "上课", "培训", "考试", "英语", "课程", "技术分享", "代码审查", "笔记"]),
    ("工作", ["会议", "周会", "评审", "产品", "项目", "客户", "发布", "规划", "重构", "上线", "代码", "需求", "汇报"]),
    ("休闲", ["健身", "电影", "旅游", "游戏", "运动", "锻炼", "散步", "跑步", "瑜伽", "休息"]),
    ("社交", ["聚会", "约会", "午餐", "晚餐", "咖啡", "聚餐", "朋友", "同学", "家人", "叙旧"]),
]


def _classify(title: str) -> str:
    t = title.lower()
    for category, keywords in _CATEGORY_RULES:
        if any(kw in t for kw in keywords):
            return category
    return "其他"

statistics_bp = Blueprint("statistics", __name__, url_prefix="/api/statistics")

_CST = timezone(timedelta(hours=8))  # Asia/Shanghai = UTC+8


def _period_range(period: str):
    """返回 period 对应的 (start, end)，均为无时区的本地时间（CST），用于与 SQLite 中存储的 naive datetime 比较。"""
    now_cst = datetime.now(_CST)

    if period == "year":
        start = now_cst.replace(month=1, day=1, hour=0, minute=0, second=0, microsecond=0)
        end = now_cst.replace(month=12, day=31, hour=23, minute=59, second=59, microsecond=0)
    elif period == "month":
        start = now_cst.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        # 下月第一天 - 1 秒 = 本月最后一秒
        next_first = (now_cst.replace(day=28) + timedelta(days=4)).replace(
            day=1, hour=0, minute=0, second=0, microsecond=0
        )
        end = next_first - timedelta(seconds=1)
    else:  # week
        days_since_monday = now_cst.weekday()
        start = (now_cst - timedelta(days=days_since_monday)).replace(
            hour=0, minute=0, second=0, microsecond=0
        )
        end = start + timedelta(days=6, hours=23, minutes=59, seconds=59)

    # SQLite 存储的是 naive datetime（服务器本地时间），去掉 tzinfo 后直接比较
    return start.replace(tzinfo=None), end.replace(tzinfo=None)


@statistics_bp.get("")
def get_statistics():
    period = request.args.get("period", "week")
    if period not in ("week", "month", "year"):
        return error_response("INVALID_PERIOD", "period 须为 week / month / year", status=400)

    start, end = _period_range(period)

    # ── 事件统计 ─────────────────────────────────────────────
    events = Event.query.filter(
        Event.start_time >= start,
        Event.start_time <= end,
    ).all()

    by_date: Counter = Counter(ev.start_time.strftime("%Y-%m-%d") for ev in events)
    active_days = len(by_date)
    busiest_day = None
    if by_date:
        day, count = by_date.most_common(1)[0]
        busiest_day = {"date": day, "count": count}

    # 按分类统计，保持固定顺序方便前端渲染
    category_map: dict[str, list] = {}
    for ev in events:
        cat = _classify(ev.title)
        category_map.setdefault(cat, []).append({
            "title": ev.title,
            "date": ev.start_time.strftime("%m-%d"),
            "time": ev.start_time.strftime("%H:%M"),
        })

    category_order = [cat for cat, _ in _CATEGORY_RULES] + ["其他"]
    by_category_ordered = {
        cat: {"count": len(category_map[cat]), "events": category_map[cat]}
        for cat in category_order
        if cat in category_map
    }

    # ── 语音操作统计 ─────────────────────────────────────────
    logs = VoiceLog.query.filter(
        VoiceLog.created_at >= start,
        VoiceLog.created_at <= end,
    ).all()
    by_action: Counter = Counter(log.action or "unknown" for log in logs)

    return ok_response(data={
        "period": period,
        "range": {"start": start.isoformat(), "end": end.isoformat()},
        "events": {
            "total": len(events),
            "active_days": active_days,
            "busiest_day": busiest_day,
            "by_category": by_category_ordered,
        },
        "voice_ops": {
            "total": len(logs),
            "by_action": dict(by_action),
        },
    })
