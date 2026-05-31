import os
import re
import time
import uuid
from datetime import datetime, timedelta
from io import BytesIO

from flask import Blueprint, request, send_from_directory
from werkzeug.datastructures import FileStorage

from database import db
from llm import parse_voice_intent
from models import Event, VoiceLog
from response import error_response, ok_response
from stt import transcribe_audio
from time_utils import parse_iso_datetime

voice_bp = Blueprint("voice", __name__, url_prefix="/api/voice")

AUDIO_STORE = os.path.normpath(
    os.path.join(os.path.dirname(__file__), "..", "audio_store")
)
AUDIO_STORE_MAX = 100
_SAFE_FILENAME_RE = re.compile(r'^\d+_[0-9a-f]{8}\.(webm|wav|mp3|ogg|m4a)$')


def _save_audio_file(audio_bytes: bytes, original_filename: str) -> str:
    os.makedirs(AUDIO_STORE, exist_ok=True)
    ext = os.path.splitext(original_filename or "")[-1].lower() or ".webm"
    filename = f"{int(time.time() * 1000)}_{uuid.uuid4().hex[:8]}{ext}"
    with open(os.path.join(AUDIO_STORE, filename), "wb") as f:
        f.write(audio_bytes)
    return filename


def _cleanup_old_audio():
    """超出 AUDIO_STORE_MAX 条的旧音频文件从磁盘删除，同时清理 24h 以上的孤立文件。"""
    excess = (
        VoiceLog.query
        .filter(VoiceLog.audio_file.isnot(None))
        .order_by(VoiceLog.created_at.desc())
        .offset(AUDIO_STORE_MAX)
        .all()
    )
    for log in excess:
        path = os.path.join(AUDIO_STORE, log.audio_file)
        try:
            os.unlink(path)
        except OSError:
            pass
        log.audio_file = None
    if excess:
        db.session.commit()

    if not os.path.isdir(AUDIO_STORE):
        return
    referenced = {
        row.audio_file
        for row in VoiceLog.query.filter(VoiceLog.audio_file.isnot(None)).all()
    }
    cutoff = time.time() - 86400
    for fname in os.listdir(AUDIO_STORE):
        if fname not in referenced:
            fpath = os.path.join(AUDIO_STORE, fname)
            if os.path.isfile(fpath) and os.path.getmtime(fpath) < cutoff:
                try:
                    os.unlink(fpath)
                except OSError:
                    pass


def _write_voice_log(transcript: str, action: str, result_msg: str, audio_file=None):
    log = VoiceLog(
        transcript=transcript,
        action=action or "unknown",
        result_msg=result_msg,
        audio_file=audio_file,
    )
    db.session.add(log)
    db.session.commit()
    try:
        _cleanup_old_audio()
    except Exception:
        pass


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


@voice_bp.route("/parse", methods=["POST"])
def parse_only():
    """仅调用 LLM 解析意图列表，不执行任何数据库操作，用于前端确认前的预览。"""
    body = request.get_json() or {}
    transcript = (body.get("transcript") or "").strip()
    if not transcript:
        return error_response("TRANSCRIPT_EMPTY", "transcript 字段不能为空", status=400)

    try:
        intents = parse_voice_intent(transcript)
    except Exception as exc:
        return error_response("INTENT_PARSE_FAILED", f"意图解析失败：{str(exc)}", status=500,
                              data={"transcript": transcript})

    return ok_response(data={"intents": intents, "transcript": transcript})


@voice_bp.route("/confirm", methods=["POST"])
def confirm_intent():
    """接收前端已确认的 intents 列表，批量执行数据库操作，不再调用 LLM。"""
    body = request.get_json() or {}
    intents = body.get("intents")
    transcript = (body.get("transcript") or "").strip()
    audio_filename = (body.get("audio_filename") or "").strip() or None

    # 兼容前端传单个 intent 对象的情况
    if isinstance(intents, dict):
        intents = [intents]
    if not intents:
        return error_response("INTENT_EMPTY", "intents 字段不能为空", status=400)

    results = []
    all_events = []
    messages = []

    for intent in intents:
        try:
            message, data = _execute_intent(intent)
            results.append({"intent": intent, "message": message, "data": data})
            messages.append(message)
            if "event" in data:
                all_events.append(data["event"])
            if "events" in data:
                all_events.extend(data["events"])
        except VoiceIntentError as exc:
            db.session.rollback()
            return error_response(exc.error_code, exc.message, status=exc.status,
                                  data={"transcript": transcript, "intent": intent})
        except Exception as exc:
            db.session.rollback()
            return error_response("INTERNAL_ERROR", f"执行失败：{str(exc)}", status=500,
                                  data={"transcript": transcript, "intent": intent})

    combined_message = "；".join(messages)
    primary_intent = intents[0] if intents else None

    actions = list({i.get("action") for i in intents if i.get("action")})
    primary_action = actions[0] if len(actions) == 1 else ("mixed" if actions else "unknown")
    try:
        _write_voice_log(transcript, primary_action, combined_message, audio_filename)
    except Exception:
        pass  # 日志写入失败不影响主流程

    return ok_response(
        message=combined_message,
        intent=primary_intent,
        data={"transcript": transcript, "events": all_events, "results": results,
              "audio_filename": audio_filename},
    )


@voice_bp.route("/transcribe", methods=["POST"])
def transcribe_only():
    """仅做语音转文字，快速返回转写结果，不调用 LLM。同时将音频保存至 audio_store。"""
    uploaded = request.files.get("audio")
    if not uploaded:
        return error_response("AUDIO_EMPTY", "请上传音频文件，字段名为 audio", status=400)

    audio_bytes = uploaded.read()
    original_name = uploaded.filename or "recording.webm"

    audio_filename = None
    try:
        audio_filename = _save_audio_file(audio_bytes, original_name)
    except Exception:
        pass  # 保存失败不阻断 STT

    fake_storage = FileStorage(stream=BytesIO(audio_bytes), filename=original_name)
    try:
        transcript = transcribe_audio(fake_storage)
    except Exception as exc:
        return error_response("STT_FAILED", f"语音识别失败：{str(exc)}", status=500)

    return ok_response(data={"transcript": transcript, "audio_filename": audio_filename})


@voice_bp.route("/execute", methods=["POST"])
def execute_only():
    """接收转写文本，调用 LLM 解析意图列表并批量执行数据库操作。"""
    body = request.get_json() or {}
    transcript = (body.get("transcript") or "").strip()
    if not transcript:
        return error_response("TRANSCRIPT_EMPTY", "transcript 字段不能为空", status=400)

    try:
        intents = parse_voice_intent(transcript)
    except Exception as exc:
        return error_response("INTENT_PARSE_FAILED", f"意图解析失败：{str(exc)}", status=500,
                              data={"transcript": transcript})

    messages = []
    all_events = []
    for intent in intents:
        try:
            message, data = _execute_intent(intent)
            messages.append(message)
            if "event" in data:
                all_events.append(data["event"])
            if "events" in data:
                all_events.extend(data["events"])
        except VoiceIntentError as exc:
            db.session.rollback()
            return error_response(exc.error_code, exc.message, status=exc.status,
                                  data={"transcript": transcript, "intent": intent})
        except Exception as exc:
            db.session.rollback()
            return error_response("INTERNAL_ERROR", f"执行失败：{str(exc)}", status=500,
                                  data={"transcript": transcript, "intent": intent})

    return ok_response(
        message="；".join(messages),
        intent=intents[0] if intents else None,
        data={"transcript": transcript, "events": all_events},
    )


@voice_bp.route("", methods=["POST"])
def handle_voice():
    """处理语音主入口，串联转写、意图解析和数据库操作。"""
    audio_file = request.files.get("audio")
    if not audio_file:
        return error_response("AUDIO_EMPTY", "请上传音频文件，字段名为 audio", status=400)

    try:
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


@voice_bp.route("/logs", methods=["GET"])
def get_voice_logs():
    """返回最近 N 条语音操作历史（默认 20 条，最多 100 条）。"""
    try:
        limit = min(int(request.args.get("limit", 20)), 100)
    except (TypeError, ValueError):
        limit = 20
    logs = (
        VoiceLog.query
        .order_by(VoiceLog.created_at.desc())
        .limit(limit)
        .all()
    )
    return ok_response(data={"logs": [log.to_dict() for log in logs]})


@voice_bp.route("/audio/<filename>", methods=["GET"])
def get_audio_file(filename):
    """提供音频文件回放，文件名须符合存储时的命名规则。"""
    if not _SAFE_FILENAME_RE.match(filename):
        return error_response("INVALID_FILENAME", "非法文件名", status=400)
    filepath = os.path.join(AUDIO_STORE, filename)
    if not os.path.isfile(filepath):
        return error_response("NOT_FOUND", "音频文件不存在", status=404)
    return send_from_directory(os.path.abspath(AUDIO_STORE), filename)
