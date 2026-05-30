import json
import os
from datetime import datetime
from urllib import error, request

from time_utils import parse_iso_datetime, resolve_query_range, serialize_range

OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gpt-4o-mini")
LLM_PROVIDER = os.getenv("LLM_PROVIDER", "ollama").lower()
OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://127.0.0.1:11434").rstrip("/")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "qwen2.5:latest")

_openai_client = None

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
"""


def get_llm_provider():
    """返回当前配置的意图解析 provider 名称。"""
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

    # 统一把模型返回的时间转换为后端后续可直接处理的 ISO 字符串。
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


def _get_openai_client():
    """延迟初始化 OpenAI 客户端，避免本地离线方案启动时强依赖该包。"""
    global _openai_client
    if _openai_client is None:
        try:
            from openai import OpenAI
        except ImportError as exc:
            raise RuntimeError(
                "未安装 openai 包，若要使用在线方案请先安装 requirements.txt 中的依赖"
            ) from exc
        _openai_client = OpenAI()
    return _openai_client


def _parse_with_openai(text: str, now: str) -> dict:
    """通过 OpenAI 在线模型完成语音文本的意图解析。"""
    client = _get_openai_client()
    response = client.chat.completions.create(
        model=OPENAI_MODEL,
        response_format={"type": "json_object"},
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT.format(now=now)},
            {"role": "user", "content": text},
        ],
    )
    return json.loads(response.choices[0].message.content)


def _parse_with_ollama(text: str, now: str) -> dict:
    """通过本地 Ollama 服务完成语音文本的意图解析。"""
    model_name = _resolve_ollama_model()
    body = json.dumps({
        "model": model_name,
        "stream": False,
        "format": "json",
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT.format(now=now)},
            {"role": "user", "content": text},
        ],
        "options": {
            "temperature": 0.1,
        },
    }).encode("utf-8")

    req = request.Request(
        f"{OLLAMA_BASE_URL}/api/chat",
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )

    try:
        with request.urlopen(req, timeout=90) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
    except error.URLError as exc:
        raise RuntimeError(
            "无法连接到本地 Ollama 服务，请先启动 Ollama 并确认 OLLAMA_BASE_URL 配置正确"
        ) from exc

    message = payload.get("message", {})
    content = message.get("content")
    if not content:
        raise RuntimeError("Ollama 未返回可解析内容")

    return json.loads(content)


def _list_ollama_models():
    """查询当前本地 Ollama 服务中已经安装的模型列表。"""
    req = request.Request(f"{OLLAMA_BASE_URL}/api/tags", method="GET")
    with request.urlopen(req, timeout=30) as resp:
        payload = json.loads(resp.read().decode("utf-8"))
    return [model.get("name") for model in payload.get("models", []) if model.get("name")]


def _resolve_ollama_model():
    """选择当前可用的本地 Ollama 模型，不存在时自动回退到已安装模型。"""
    try:
        installed = _list_ollama_models()
    except error.URLError as exc:
        raise RuntimeError(
            "无法连接到本地 Ollama 服务，请先启动 Ollama 并确认 OLLAMA_BASE_URL 配置正确"
        ) from exc

    if not installed:
        raise RuntimeError("本地 Ollama 没有可用模型，请先执行 ollama pull")

    if OLLAMA_MODEL in installed:
        return OLLAMA_MODEL

    # 优先排除 embedding 类模型，尽量选择可聊天的通用模型。
    preferred = [
        name for name in installed
        if "embedding" not in name.lower() and "bge" not in name.lower() and "embed" not in name.lower()
    ]
    if preferred:
        return preferred[0]
    return installed[0]


def parse_voice_intent(text: str) -> list:
    """根据 provider 配置解析语音文本，返回标准化意图列表（支持多事件）。"""
    now = datetime.now().strftime("%Y-%m-%d %H:%M %A")
    try:
        if LLM_PROVIDER == "openai":
            payload = _parse_with_openai(text, now)
        elif LLM_PROVIDER == "ollama":
            payload = _parse_with_ollama(text, now)
        else:
            raise RuntimeError(f"不支持的 LLM_PROVIDER: {LLM_PROVIDER}")

        # 兼容新格式 {"intents": [...]} 和旧格式单对象
        if "intents" in payload and isinstance(payload["intents"], list):
            raw_list = payload["intents"]
        elif isinstance(payload, list):
            raw_list = payload
        else:
            raw_list = [payload]

        return [_normalize_intent(item, text) for item in raw_list]
    except Exception as exc:
        raise RuntimeError(f"LLM 解析失败: {str(exc)}")
