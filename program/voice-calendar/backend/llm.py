import json
import os
from datetime import datetime

from time_utils import parse_iso_datetime, resolve_query_range, serialize_range

LLM_PROVIDER = os.getenv("LLM_PROVIDER", "qwen").lower()
DASHSCOPE_API_KEY = os.getenv("DASHSCOPE_API_KEY", "")
QWEN_MODEL = os.getenv("QWEN_MODEL", "qwen-plus")

_qwen_client = None

SYSTEM_PROMPT = """你是一个智能日历助手，擅长从口语化描述中提取所有活动并编排成合理日程。
现在是 {now}，用户时区为 Asia/Shanghai。

## 输出格式
只返回如下 JSON，不要有任何多余文字：
{{
  "intents": [
    {{
      "action": "add" | "delete" | "query",
      "title": "事件名称",
      "start_time": "ISO8601，如 2025-05-30T09:00:00（add 必填）",
      "end_time":   "ISO8601（add 必填，根据时长推算）",
      "description": "备注，把不确定因素写在这里（可选）",
      "query_range": "today | tomorrow | this_week（仅 query 必填）"
    }}
  ]
}}

## 相关性判断
内容与日历/事件/安排/提醒完全无关（纯闲聊、问天气等）→ 返回 {{"intents": []}}。

## 编排规则（用户说"帮我安排"时严格执行）

### 时间推算
- 没有给出具体时刻时，根据常识推断：上午 08:00 开始，中午 12:00，下午 13:30，晚上 19:00。
- 时长模糊（"六七个小时"）→ 取中间值（6.5 小时）。
- 时长未提及 → 按活动类型估算：吃饭 1h，购物 30min，洗衣 1h，背单词/学习 1h，游戏/娱乐 1h，睡觉 8h。
- 事件之间留 5-10 分钟缓冲。

### 不确定活动
- "也可能 X"、"或者 X" → 仍然创建事件，在 description 中注明"可能调整"。
- 语音识别噪声（无意义词句）直接忽略，不影响日程。

### 完整性
- 提取用户提到的**每一项**独立活动，一项都不能漏。
- 有硬性截止时间的（"11点半前睡"）→ 先定好截止事件，其余活动在截止前倒排。
- 按活动先后顺序首尾相接排列，不允许时间重叠。

## 示例
- "明天下午三点开组会" → intents=[{{add, 组会, 明天15:00~16:00}}]
- "取消明天的组会" → intents=[{{delete, 组会}}]
- "今天有什么安排" → intents=[{{query, query_range=today}}]
- "今天天气怎么样" → intents=[]
- "我昨天已经吃完西瓜了" → intents=[{{delete, 吃西瓜, 昨天}}]（"已经做完/吃完/完成了"均视为 delete）
- "刚才的会议结束了" → intents=[{{delete, 会议, 当前时间附近}}]
"""


def get_llm_provider():
    return LLM_PROVIDER


def _normalize_intent(payload: dict, text: str) -> dict:
    """将模型输出标准化为后端统一使用的意图结构。"""
    action = payload.get("action")
    if action not in {"add", "delete", "query"}:
        raise RuntimeError("模型未返回有效 action")

    normalized = {
        "action": action,
        "title": payload.get("title"),
        "start_time": None,
        "end_time": None,
        "description": payload.get("description"),
        "query_range": None,
        "raw_text": text,
    }

    if payload.get("start_time"):
        normalized["start_time"] = parse_iso_datetime(payload["start_time"]).isoformat()
    if payload.get("end_time"):
        normalized["end_time"] = parse_iso_datetime(payload["end_time"]).isoformat()

    if action == "add" and (not normalized["title"] or not normalized["start_time"]):
        raise RuntimeError("新增事件缺少 title 或 start_time")

    if action == "query":
        start, end, label = resolve_query_range(payload.get("query_range"))
        normalized["query_range"] = serialize_range(start, end, label)

    return normalized


def _get_qwen_client():
    """延迟初始化 DashScope Qwen 客户端（复用 OpenAI SDK，仅切换 base_url）。"""
    global _qwen_client
    if _qwen_client is None:
        if not DASHSCOPE_API_KEY:
            raise RuntimeError("未配置 DASHSCOPE_API_KEY")
        try:
            import httpx
            from openai import OpenAI
        except ImportError as exc:
            raise RuntimeError(
                "未安装依赖包，请执行: pip install openai httpx"
            ) from exc
        # trust_env=False 忽略系统代理，避免本地代理配置干扰云端 API 连接
        _qwen_client = OpenAI(
            api_key=DASHSCOPE_API_KEY,
            base_url="https://dashscope.aliyuncs.com/compatible-mode/v1",
            http_client=httpx.Client(trust_env=False),
        )
    return _qwen_client


def parse_voice_intent(text: str) -> list:
    """调用 Qwen 解析语音文本，返回标准化意图列表（支持多事件）。"""
    now = datetime.now().strftime("%Y-%m-%d %H:%M %A")
    try:
        client = _get_qwen_client()
        response = client.chat.completions.create(
            model=QWEN_MODEL,
            response_format={"type": "json_object"},
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT.format(now=now)},
                {"role": "user", "content": text},
            ],
        )
        payload = json.loads(response.choices[0].message.content)

        if "intents" in payload and isinstance(payload["intents"], list):
            raw_list = payload["intents"]
        elif isinstance(payload, list):
            raw_list = payload
        else:
            raw_list = [payload]

        return [_normalize_intent(item, text) for item in raw_list]
    except Exception as exc:
        raise RuntimeError(f"LLM 解析失败: {str(exc)}")
