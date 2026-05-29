from flask import jsonify


def ok_response(data=None, message="", intent=None, status=200):
    payload = {
        "success": True,
        "message": message,
        "data": data or {},
    }
    if intent is not None:
        payload["intent"] = intent
    return jsonify(payload), status


def error_response(error_code, message, status=400, data=None):
    payload = {
        "success": False,
        "error_code": error_code,
        "message": message,
    }
    if data is not None:
        payload["data"] = data
    return jsonify(payload), status
