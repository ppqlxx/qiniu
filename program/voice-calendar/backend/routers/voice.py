from datetime import datetime, timedelta

from flask import Blueprint, request

from database import db
from llm import parse_voice_intent
from models import Event
from response import error_response, ok_response
from stt import transcribe_audio
from time_utils import parse_iso_datetime

voice_bp = Blueprint("voice", __name__, url_prefix="/api/voice")


class VoiceIntentError(Exception):
    """表示语音意图执行阶段的业务异常。"""

    def __init__(self, error_code, message, status=400):
        """保存错误码、提示文案和接口状态码。"""
        super().__init__(message)
        self.error_code = error_code
        self.message = message
        self.status = status


def _build_query_message(events, label):
    """根据查询结果数量和时间标签生成用户可读提示语。"""
    if not events:
        if label == "today":
            return "您今天暂时没有安排"
        if label == "tomorrow":
            return "您明天暂时没有安排"
        return "您这段时间暂时没有安排"

    label_text = {
        "today": "今天",
        "tomorrow": "明天",
        "this_week": "这周",
        "custom": "当前范围内",
    }.get(label, "当前范围内")
    return f"您{label_text}共有 {len(events)} 项安排"


def _find_event_for_delete(title, start_time):
    """按标题和时间范围查找最适合删除的事件记录。"""
    query = Event.query.filter(Event.title.contains(title))
    if start_time:
        # 删除时只在目标日期内匹配，避免同名事件跨天误删。
        start_of_day = start_time.replace(hour=0, minute=0, second=0, microsecond=0)
        end_of_day = start_of_day + timedelta(days=1)
        query = query.filter(Event.start_time >= start_of_day, Event.start_time < end_of_day)
    else:
        query = query.filter(Event.start_time >= datetime.now())
    return query.order_by(Event.start_time).first()


def _execute_intent(intent):
    """根据结构化意图执行新增、查询或删除，并返回提示与结果数据。"""
    action = intent.get("action")

    if action == "add":
        start = parse_iso_datetime(intent["start_time"])
        end = parse_iso_datetime(intent.get("end_time")) or (start + timedelta(hours=1))
        event = Event(
            title=intent["title"],
            start_time=start,
            end_time=end,
            description=intent.get("description", ""),
        )
        db.session.add(event)
        db.session.commit()
        time_text = start.strftime("%m月%d日 %H:%M")
        return (
            f"已添加事件：{intent['title']}，时间为 {time_text}",
            {"event": event.to_dict()},
        )

    if action == "delete":
        title = (intent.get("title") or "").strip()
        if not title:
            raise VoiceIntentError("VALIDATION_ERROR", "删除事件需要提供事件名称", status=400)

        event = _find_event_for_delete(title, parse_iso_datetime(intent.get("start_time")))
        if not event:
            raise VoiceIntentError(
                "EVENT_NOT_FOUND",
                f"没有找到名称包含【{title}】的匹配事件",
                status=404,
            )

        deleted_event = event.to_dict()
        db.session.delete(event)
        db.session.commit()
        return (f"已删除事件：{deleted_event['title']}", {"deleted_event": deleted_event})

    if action == "query":
        query_range = intent.get("query_range") or {}
        start = parse_iso_datetime(query_range.get("start"))
        end = parse_iso_datetime(query_range.get("end"))
        if not start or not end:
            raise VoiceIntentError("TIME_PARSE_FAILED", "查询时间范围解析失败", status=400)

        events = (
            Event.query
            .filter(Event.start_time.between(start, end))
            .order_by(Event.start_time)
            .all()
        )
        items = [event.to_dict() for event in events]
        return (
            _build_query_message(items, query_range.get("label", "custom")),
            {"events": items},
        )

    raise VoiceIntentError("INTENT_PARSE_FAILED", "抱歉，没有识别到有效的操作指令", status=400)


@voice_bp.route("", methods=["POST"])
def handle_voice():
    """处理语音主入口，串联转写、意图解析和数据库操作。"""
    audio_file = request.files.get("audio")
    if not audio_file:
        return error_response("AUDIO_EMPTY", "请上传音频文件，字段名为 audio", status=400)

    try:
        # 先完成音频转文字，再把结果交给意图解析模块处理。
        transcript = transcribe_audio(audio_file)
    except Exception as exc:
        return error_response("STT_FAILED", f"语音识别失败：{str(exc)}", status=500)

    try:
        intent = parse_voice_intent(transcript)
    except Exception as exc:
        return error_response(
            "INTENT_PARSE_FAILED",
            f"意图解析失败：{str(exc)}",
            status=500,
            data={"transcript": transcript},
        )

    try:
        # 统一由意图执行器分派新增、查询和删除逻辑。
        message, data = _execute_intent(intent)
    except VoiceIntentError as exc:
        return error_response(
            exc.error_code,
            exc.message,
            status=exc.status,
            data={"transcript": transcript, "intent": intent},
        )
    except Exception as exc:
        db.session.rollback()
        return error_response(
            "INTERNAL_ERROR",
            f"执行失败：{str(exc)}",
            status=500,
            data={"transcript": transcript, "intent": intent},
        )

    return ok_response(
        message=message,
        intent=intent,
        data={"transcript": transcript, **data},
    )
