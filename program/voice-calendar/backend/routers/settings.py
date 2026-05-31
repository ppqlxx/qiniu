import json

from flask import Blueprint, request

from database import db
from models import AppSettings
from response import ok_response

settings_bp = Blueprint("settings", __name__)

DEFAULT_SETTINGS = {
    "voice_language": "zh",
    "tts_rate": 1.0,
    "tts_volume": 1.0,
    "voice_reminder_enabled": True,
    "reminder_advance_seconds": 60,
    "browser_notification_enabled": False,
    "temperature_unit": "celsius",
    "city": "",
    "theme": "light",
    "voice_history_limit": 20,
    "action_history_limit": 20,
}


def _get_or_init_row():
    row = AppSettings.query.first()
    if not row:
        row = AppSettings(settings_json=json.dumps(DEFAULT_SETTINGS))
        db.session.add(row)
        db.session.commit()
    return row


@settings_bp.get("/api/settings")
def get_settings():
    row = _get_or_init_row()
    merged = {**DEFAULT_SETTINGS, **json.loads(row.settings_json)}
    return ok_response(data=merged, message="获取设置成功")


@settings_bp.put("/api/settings")
def update_settings():
    payload = request.get_json(silent=True) or {}
    row = _get_or_init_row()
    current = {**DEFAULT_SETTINGS, **json.loads(row.settings_json)}
    for key, value in payload.items():
        if key in DEFAULT_SETTINGS:
            current[key] = value
    row.settings_json = json.dumps(current)
    db.session.commit()
    return ok_response(data=current, message="设置已保存")
