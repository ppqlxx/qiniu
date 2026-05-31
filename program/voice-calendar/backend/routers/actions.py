from flask import Blueprint, request

from database import db
from models import ActionLog
from response import error_response, ok_response

actions_bp = Blueprint("actions", __name__, url_prefix="/api/actions")

_MAX_LOGS = 50


@actions_bp.route("", methods=["POST"])
def log_action():
    """记录一条操作日志。"""
    body = request.get_json() or {}
    text = (body.get("text") or "").strip()
    if not text:
        return error_response("VALIDATION_ERROR", "text 不能为空", status=400)

    log = ActionLog(text=text)
    db.session.add(log)
    db.session.commit()

    # 保留最近 _MAX_LOGS 条，删除更早的记录
    excess = (
        ActionLog.query
        .order_by(ActionLog.created_at.desc())
        .offset(_MAX_LOGS)
        .all()
    )
    for old in excess:
        db.session.delete(old)
    if excess:
        db.session.commit()

    return ok_response(data={"id": log.id}, status=201)


@actions_bp.route("", methods=["GET"])
def get_action_logs():
    """返回最近 N 条操作日志（默认 20，最多 50）。"""
    try:
        limit = min(int(request.args.get("limit", 20)), _MAX_LOGS)
    except (TypeError, ValueError):
        limit = 20
    logs = (
        ActionLog.query
        .order_by(ActionLog.created_at.desc())
        .limit(limit)
        .all()
    )
    return ok_response(data={"logs": [log.to_dict() for log in logs]})
