from flask import Blueprint, request

from database import db
from models import Event
from response import error_response, ok_response
from time_utils import get_range_from_request, parse_iso_datetime, serialize_range

events_bp = Blueprint("events", __name__, url_prefix="/api/events")


@events_bp.route("", methods=["GET"])
def list_events():
    start, end, label = get_range_from_request(request.args)
    events = (
        Event.query
        .filter(Event.start_time.between(start, end))
        .order_by(Event.start_time)
        .all()
    )
    return ok_response(data={
        "events": [event.to_dict() for event in events],
        "range": serialize_range(start, end, label),
    })


@events_bp.route("", methods=["POST"])
def create_event():
    data = request.get_json() or {}
    if not data.get("title") or not data.get("start_time"):
        return error_response("VALIDATION_ERROR", "title 和 start_time 为必填项", status=400)

    try:
        event = Event(
            title=data["title"].strip(),
            start_time=parse_iso_datetime(data["start_time"]),
            end_time=parse_iso_datetime(data.get("end_time")),
            description=data.get("description", ""),
        )
        db.session.add(event)
        db.session.commit()
    except Exception as exc:
        db.session.rollback()
        return error_response("DB_ERROR", f"事件创建失败：{str(exc)}", status=500)

    return ok_response(
        message="事件创建成功",
        data={"event": event.to_dict()},
        status=201,
    )


@events_bp.route("/<int:event_id>", methods=["DELETE"])
def delete_event(event_id):
    event = Event.query.get(event_id)
    if not event:
        return error_response("EVENT_NOT_FOUND", "事件不存在", status=404)

    db.session.delete(event)
    db.session.commit()
    return ok_response(message=f"已删除事件：{event.title}")


@events_bp.route("/<int:event_id>", methods=["GET"])
def get_event(event_id):
    event = Event.query.get(event_id)
    if not event:
        return error_response("EVENT_NOT_FOUND", "事件不存在", status=404)
    return ok_response(data={"event": event.to_dict()})
