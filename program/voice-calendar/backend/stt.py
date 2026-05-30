import os
import tempfile
from pathlib import Path
from urllib import request as urllib_request, error as urllib_error

STT_PROVIDER = os.getenv("STT_PROVIDER", "funasr").lower()
OPENAI_STT_MODEL = os.getenv("OPENAI_STT_MODEL", "whisper-1")
FUNASR_HTTP_URL = os.getenv("FUNASR_HTTP_URL", "http://127.0.0.1:10095").rstrip("/")

_openai_client = None


def get_stt_provider():
    """返回当前配置的语音识别 provider 名称。"""
    return STT_PROVIDER


def _get_openai_client():
    """延迟初始化 OpenAI 客户端，避免本地离线方案启动时强依赖该包。"""
    global _openai_client
    if _openai_client is None:
        try:
            from openai import OpenAI
        except ImportError as exc:
            raise RuntimeError(
                "未安装 openai 包，若要使用在线语音识别请先安装 requirements.txt 中的依赖"
            ) from exc
        _openai_client = OpenAI()
    return _openai_client


def _save_temp_audio(audio_file):
    """将上传的音频文件保存为临时文件，供后续识别流程读取。"""
    suffix = os.path.splitext(audio_file.filename or "")[-1] or ".webm"
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        audio_file.save(tmp.name)
        return tmp.name


def _transcribe_with_openai(audio_file):
    """通过 OpenAI Whisper 接口完成语音转文字。"""
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


def _transcribe_with_funasr(audio_file):
    """将音频转发到本地 FunASR HTTP 服务（asr-service）完成语音转文字。"""
    import json
    import uuid

    tmp_path = _save_temp_audio(audio_file)
    try:
        boundary = uuid.uuid4().hex
        filename = Path(tmp_path).name
        with open(tmp_path, "rb") as f:
            audio_data = f.read()

        body = (
            f"--{boundary}\r\n"
            f'Content-Disposition: form-data; name="audio"; filename="{filename}"\r\n'
            f"Content-Type: audio/webm\r\n\r\n"
        ).encode() + audio_data + f"\r\n--{boundary}--\r\n".encode()

        req = urllib_request.Request(
            f"{FUNASR_HTTP_URL}/transcribe",
            data=body,
            headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
            method="POST",
        )
        try:
            with urllib_request.urlopen(req, timeout=60) as resp:
                result = json.loads(resp.read().decode("utf-8"))
        except urllib_error.URLError as exc:
            raise RuntimeError(
                f"无法连接到 FunASR 服务，请确认 asr-service 正在运行（{FUNASR_HTTP_URL}）"
            ) from exc

        text = result.get("text", "").strip()
        if not text:
            raise RuntimeError("FunASR 服务未返回有效文本")
        return text
    finally:
        Path(tmp_path).unlink(missing_ok=True)


def transcribe_audio(audio_file):
    """根据配置选择在线或本地语音识别方案。"""
    if STT_PROVIDER == "openai":
        return _transcribe_with_openai(audio_file)
    if STT_PROVIDER == "funasr":
        return _transcribe_with_funasr(audio_file)
    raise RuntimeError(f"不支持的 STT_PROVIDER: {STT_PROVIDER}")
