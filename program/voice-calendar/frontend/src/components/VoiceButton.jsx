import { useRef, useState } from "react";

import { getErrorMessage, postVoice } from "../api";

export default function VoiceButton({ onResult, onError }) {
  const [status, setStatus] = useState("idle");
  const [transcriptPreview, setTranscriptPreview] = useState("");

  const recorderRef = useRef(null);
  const streamRef = useRef(null);
  const chunksRef = useRef([]);

  const isRecording = status === "recording";
  const isProcessing = status === "processing";

  const startRecording = async () => {
    if (isRecording || isProcessing) return;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      streamRef.current = stream;
      recorderRef.current = recorder;
      chunksRef.current = [];

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };

      recorder.onstop = async () => {
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        if (!blob.size) {
          setStatus("idle");
          onError?.("录音内容为空，请重试");
          return;
        }

        setStatus("processing");
        try {
          const result = await postVoice(blob);
          setTranscriptPreview(result.data?.transcript || "");
          onResult?.(result);
          setStatus("idle");
        } catch (error) {
          setStatus("error");
          onError?.(getErrorMessage(error), error.response?.data?.data);
        }
      };

      recorder.start();
      setTranscriptPreview("");
      setStatus("recording");
    } catch {
      setStatus("error");
      onError?.("无法访问麦克风，请检查浏览器权限");
    }
  };

  const stopRecording = () => {
    if (!isRecording) return;

    recorderRef.current?.stop();
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  };

  return (
    <div className="voice-button-card">
      <button
        className={[
          "voice-button",
          isRecording ? "voice-button-recording" : "",
          isProcessing ? "voice-button-processing" : "",
        ].join(" ")}
        onPointerDown={startRecording}
        onPointerUp={stopRecording}
        onPointerLeave={stopRecording}
        disabled={isProcessing}
        type="button"
      >
        {isProcessing ? "⏳" : "🎤"}
      </button>

      <div className="voice-helper">
        {isRecording ? (
          <>
            <div className="wave" aria-hidden="true">
              <span />
              <span />
              <span />
              <span />
            </div>
            <div>松开即可发送语音</div>
          </>
        ) : isProcessing ? (
          "正在识别并解析语音..."
        ) : (
          "按住说话，松开发送"
        )}
      </div>

      {transcriptPreview ? (
        <div className="voice-helper">最近转写：{transcriptPreview}</div>
      ) : null}
    </div>
  );
}
