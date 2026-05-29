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


def _get_funasr_model():
    """延迟初始化本地 FunASR 模型实例。"""
    global _funasr_model
    if _funasr_model is not None:
        return _funasr_model

    try:
        from funasr import AutoModel
    except ImportError as exc:
        raise RuntimeError(
            "未安装 funasr，请先在 backend 环境执行 pip install -r requirements.txt"
        ) from exc

    _funasr_model = AutoModel(
        model=FUNASR_MODEL,
        trust_remote_code=True,
        device=FUNASR_DEVICE,
    )
    return _funasr_model


def _extract_funasr_text(result):
    """从 FunASR 返回结果中提取统一的文本内容。"""
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
    """通过本地 FunASR 模型完成语音转文字。"""
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
    """根据配置选择在线或本地语音识别方案。"""
    if STT_PROVIDER == "openai":
        return _transcribe_with_openai(audio_file)
    if STT_PROVIDER == "funasr":
        return _transcribe_with_funasr(audio_file)
    raise RuntimeError(f"不支持的 STT_PROVIDER: {STT_PROVIDER}")
