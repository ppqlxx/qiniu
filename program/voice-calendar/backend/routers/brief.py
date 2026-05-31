from flask import Blueprint, request

from llm import generate_brief
from response import error_response, ok_response

brief_bp = Blueprint("brief", __name__)


@brief_bp.post("/api/brief")
def create_brief():
    payload = request.get_json(silent=True) or {}
    events = payload.get("events", [])
    scope = payload.get("scope", "今日")

    if not isinstance(events, list):
        return error_response("INVALID_PARAMS", "events 必须是数组")

    try:
        text = generate_brief(events, scope)
        return ok_response(data={"text": text}, message="播报生成成功")
    except RuntimeError as exc:
        return error_response("LLM_ERROR", str(exc), status=500)
