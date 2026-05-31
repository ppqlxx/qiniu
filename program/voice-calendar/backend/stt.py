import base64
import hashlib
import hmac
import os
import subprocess
import tempfile
import time
from email.utils import formatdate
from pathlib import Path

import requests as _req

STT_PROVIDER = os.getenv("STT_PROVIDER", "aliyun").lower()
ALIYUN_ACCESS_KEY_ID = os.getenv("ALIYUN_ACCESS_KEY_ID", "")
ALIYUN_ACCESS_KEY_SECRET = os.getenv("ALIYUN_ACCESS_KEY_SECRET", "")
ALIYUN_NLS_APP_KEY = os.getenv("ALIYUN_NLS_APP_KEY", "")

_nls_token_cache: dict = {"token": None, "expire": 0}


def get_stt_provider():
    return STT_PROVIDER


def _save_temp_audio(audio_file) -> str:
    suffix = os.path.splitext(audio_file.filename or "")[-1] or ".webm"
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        audio_file.save(tmp.name)
        return tmp.name


def _get_nls_token() -> str:
    """获取阿里云 NLS Token，缓存有效期内直接复用（避免每次请求重新签名）。"""
    global _nls_token_cache
    now = time.time()
    if _nls_token_cache["token"] and _nls_token_cache["expire"] > now + 60:
        return _nls_token_cache["token"]

    if not ALIYUN_ACCESS_KEY_ID or not ALIYUN_ACCESS_KEY_SECRET:
        raise RuntimeError("未配置 ALIYUN_ACCESS_KEY_ID 或 ALIYUN_ACCESS_KEY_SECRET")

    date = formatdate(usegmt=True)
    path = "/pop/2018-05-18/tokens"
    # NLS Meta 使用 ACS REST 签名：Method\nAccept\nContent-MD5\nContent-Type\nDate\nPath
    string_to_sign = f"POST\napplication/json\n\napplication/json\n{date}\n{path}"
    key = ALIYUN_ACCESS_KEY_SECRET.encode()
    sig = base64.b64encode(hmac.new(key, string_to_sign.encode(), hashlib.sha1).digest()).decode()

    resp = _req.post(
        "https://nls-meta.cn-shanghai.aliyuncs.com" + path,
        headers={
            "Authorization": f"acs {ALIYUN_ACCESS_KEY_ID}:{sig}",
            "Date": date,
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
        proxies={"http": None, "https": None},
        timeout=10,
    )
    data = resp.json()
    if "Token" not in data:
        raise RuntimeError(f"NLS Token 获取失败: {data.get('Message', data)}")

    _nls_token_cache["token"] = data["Token"]["Id"]
    _nls_token_cache["expire"] = data["Token"]["ExpireTime"]
    return _nls_token_cache["token"]


def transcribe_audio(audio_file) -> str:
    """通过阿里云 NLS 一句话识别 API 完成语音转文字。"""
    if not ALIYUN_NLS_APP_KEY:
        raise RuntimeError("未配置 ALIYUN_NLS_APP_KEY")

    token = _get_nls_token()
    tmp_path = _save_temp_audio(audio_file)
    wav_path = None
    try:
        suffix = Path(tmp_path).suffix.lstrip(".").lower() or "webm"

        # NLS 不支持 webm/ogg 容器，用 ffmpeg 转成 16kHz 单声道 WAV
        if suffix in ("webm", "ogg", "mp4"):
            wav_path = tmp_path + ".wav"
            result = subprocess.run(
                ["ffmpeg", "-y", "-i", tmp_path, "-ar", "16000", "-ac", "1", wav_path],
                capture_output=True, timeout=30,
            )
            if result.returncode != 0:
                raise RuntimeError(f"音频转换失败: {result.stderr.decode(errors='replace')}")
            send_path, fmt, sample_rate = wav_path, "wav", 16000
        else:
            send_path, fmt, sample_rate = tmp_path, suffix or "wav", 16000

        with open(send_path, "rb") as f:
            audio_data = f.read()

        resp = _req.post(
            "https://nls-gateway-cn-shanghai.aliyuncs.com/stream/v1/asr",
            params={
                "appkey": ALIYUN_NLS_APP_KEY,
                "format": fmt,
                "sample_rate": sample_rate,
                "enable_punctuation_prediction": "true",
                "enable_inverse_text_normalization": "true",
            },
            headers={
                "X-NLS-Token": token,
                "Content-Type": "application/octet-stream",
            },
            data=audio_data,
            proxies={"http": None, "https": None},
            timeout=30,
        )
        result = resp.json()

        if result.get("status") == 20000000:
            text = (result.get("result") or "").strip()
            if not text:
                raise RuntimeError("阿里云 NLS 未识别到语音内容，请重试")
            return text

        raise RuntimeError(
            f"阿里云 NLS 识别失败（code {result.get('status')}）: {result.get('message', '')}"
        )
    finally:
        Path(tmp_path).unlink(missing_ok=True)
        if wav_path:
            Path(wav_path).unlink(missing_ok=True)
