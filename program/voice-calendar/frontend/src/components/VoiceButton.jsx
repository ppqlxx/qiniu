import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { getErrorMessage, postVoice } from "../api";

export default function VoiceButton({ onResult, onError }) {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [status, setStatus] = useState("idle");
  const [transcriptPreview, setTranscriptPreview] = useState("");

  const recorderRef = useRef(null);
  const streamRef = useRef(null);
  const chunksRef = useRef([]);

  const isRecording = status === "recording";
  const isProcessing = status === "processing";

  useEffect(() => {
    if (!isModalOpen) return undefined;

    const handleKeyDown = (event) => {
      if (event.key === "Escape" && !isRecording && !isProcessing) {
        setIsModalOpen(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isModalOpen, isProcessing, isRecording]);

  const openModal = () => {
    setTranscriptPreview("");
    setStatus("idle");
    setIsModalOpen(true);
  };

  const closeModal = () => {
    if (isRecording || isProcessing) return;
    setIsModalOpen(false);
  };

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
          setIsModalOpen(false);
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
    <>
      <button className="voice-trigger" onClick={openModal} type="button" aria-label="打开语音录入">
        <span className="voice-trigger-icon">🎤</span>
      </button>

      {isModalOpen
        ? createPortal(
            <div className="modal-overlay" onClick={closeModal} role="presentation">
              <div className="voice-modal" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true">
            <div className="voice-modal-header">
              <div>
                <h2>语音录入</h2>
              </div>
              <button className="modal-close" onClick={closeModal} type="button" aria-label="关闭">
                ×
              </button>
                </div>

                <div className="voice-modal-body">
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

                  <div className="voice-helper modal-helper">
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
                  "按住上方话筒开始录音，松开发送。"
                )}
              </div>

                  <div className="detail-block modal-detail-block">
                    <label>最近转写</label>
                    <div className="detail-surface">{transcriptPreview || "暂无"}</div>
                  </div>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
