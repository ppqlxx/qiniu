import os
import tempfile
from pathlib import Path

STT_PROVIDER = os.getenv("STT_PROVIDER", "funasr").lower()
OPENAI_STT_MODEL = os.getenv("OPENAI_STT_MODEL", "whisper-1")
FUNASR_MODEL = os.getenv("FUNASR_MODEL", "iic/SenseVoiceSmall")
FUNASR_DEVICE = os.getenv("FUNASR_DEVICE", "cpu")

_openai_client = None
_funasr_model = None


def get_stt_provider():
    return STT_PROVIDER


def _get_openai_client():
    global _openai_client
    if _openai_client is None:
        try:
            from openai import OpenAI
        except ImportError as exc:
            raise RuntimeError(
                "鏈畨瑁?openai 鍖咃紝鑻ヨ浣跨敤鍦ㄧ嚎璇煶璇嗗埆璇峰厛瀹夎 requirements.txt 涓殑渚濊禆"
            ) from exc
        _openai_client = OpenAI()
    return _openai_client


def _save_temp_audio(audio_file):
    suffix = os.path.splitext(audio_file.filename or "")[-1] or ".webm"
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        audio_file.save(tmp.name)
        return tmp.name


def _transcribe_with_openai(audio_file):
    client = _get_openai_client()
    tmp_path = _save_temp_audio(audio_file)
    try:
        with open(tmp_path, "rb") as stream:
            transcript = client.audio.transcriptions.create(
                model=OPENAI_STT_MODEL,
                file=stream,
                language="zh",
            )
        return transcript.text
    finally:
        Path(tmp_path).unlink(missing_ok=True)


def _get_funasr_model():
    global _funasr_model
    if _funasr_model is not None:
        return _funasr_model

    try:
        from funasr import AutoModel
    except ImportError as exc:
        raise RuntimeError(
            "鏈畨瑁?funasr锛岃鍏堝湪 backend 鐜鎵ц pip install -r requirements.txt"
        ) from exc

    _funasr_model = AutoModel(
        model=FUNASR_MODEL,
        trust_remote_code=True,
        device=FUNASR_DEVICE,
    )
    return _funasr_model


def _extract_funasr_text(result):
    if isinstance(result, list) and result:
        first = result[0]
        if isinstance(first, dict):
            return first.get("text", "").strip()
        if isinstance(first, str):
            return first.strip()
    if isinstance(result, dict):
        return str(result.get("text", "")).strip()
    if isinstance(result, str):
        return result.strip()
    return ""


def _transcribe_with_funasr(audio_file):
    tmp_path = _save_temp_audio(audio_file)
    try:
        model = _get_funasr_model()
        result = model.generate(
            input=tmp_path,
            cache={},
            language="zh",
            use_itn=True,
        )
        text = _extract_funasr_text(result)
        if not text:
            raise RuntimeError("FunASR 未返回有效文本")
        return text
    finally:
        Path(tmp_path).unlink(missing_ok=True)


def transcribe_audio(audio_file):
    if STT_PROVIDER == "openai":
        return _transcribe_with_openai(audio_file)
    if STT_PROVIDER == "funasr":
        return _transcribe_with_funasr(audio_file)
    raise RuntimeError(f"涓嶆敮鎸佺殑 STT_PROVIDER: {STT_PROVIDER}")
