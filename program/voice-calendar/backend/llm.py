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

SYSTEM_PROMPT = """你是一个日历助手，将用户的语音转文字内容解析为结构化 JSON 指令。
今天是 {today}，用户时区为 Asia/Shanghai。

请严格按照以下格式返回 JSON，只返回 JSON，不要包含任何其他文字：
{{
  "action": "add" | "delete" | "query",
  "title": "事件名称（add 和 delete 时尽量填写）",
  "start_time": "ISO8601 格式时间（add 时必填，delete 时可选，例如 2025-05-30T15:00:00）",
  "end_time": "ISO8601 格式时间（可选，默认为 start_time 加一小时）",
  "description": "备注说明（可选）",
  "query_range": "today | tomorrow | this_week（仅 query 时必填）"
}}

示例：
- 用户说"明天下午三点开组会" → action=add, title=组会, start_time=明天15:00
- 用户说"取消明天的组会" → action=delete, title=组会, start_time=明天
- 用户说"我今天有什么安排" → action=query, query_range=today
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


def _parse_with_openai(text: str, today: str) -> dict:
    """通过 OpenAI 在线模型完成语音文本的意图解析。"""
    client = _get_openai_client()
    response = client.chat.completions.create(
        model=OPENAI_MODEL,
        response_format={"type": "json_object"},
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT.format(today=today)},
            {"role": "user", "content": text},
        ],
    )
    return json.loads(response.choices[0].message.content)


def _parse_with_ollama(text: str, today: str) -> dict:
    """通过本地 Ollama 服务完成语音文本的意图解析。"""
    model_name = _resolve_ollama_model()
    body = json.dumps({
        "model": model_name,
        "stream": False,
        "format": "json",
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT.format(today=today)},
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


def parse_voice_intent(text: str) -> dict:
    """根据 provider 配置解析语音文本，并返回标准化后的意图结果。"""
    today = datetime.now().strftime("%Y-%m-%d %A")
    try:
        # 在线与本地模型共用统一输出结构，方便后端后续流程复用。
        if LLM_PROVIDER == "openai":
            payload = _parse_with_openai(text, today)
        elif LLM_PROVIDER == "ollama":
            payload = _parse_with_ollama(text, today)
        else:
            raise RuntimeError(f"不支持的 LLM_PROVIDER: {LLM_PROVIDER}")

        return _normalize_intent(payload, text)
    except Exception as exc:
        raise RuntimeError(f"LLM 解析失败: {str(exc)}")
