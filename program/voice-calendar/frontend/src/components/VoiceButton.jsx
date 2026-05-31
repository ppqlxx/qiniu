import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import dayjs from "dayjs";

import { confirmVoiceIntent, getErrorMessage, parseVoiceIntent, transcribeAudio } from "../api";

function buildConfirmText(intent) {
  if (intent.action === "add") {
    const time = intent.start_time ? dayjs(intent.start_time).format("MM月DD日 HH:mm") : "时间未知";
    return `添加「${intent.title || "未命名"}」于 ${time}`;
  }
  if (intent.action === "delete") {
    return `删除「${intent.title || "未命名"}」`;
  }
  return null;
}

function needsConfirm(intents) {
  return intents.some((i) => i.action === "add" || i.action === "delete");
}

export default function VoiceButton({ onResult, onError }) {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [status, setStatus] = useState("idle");
  const [transcriptPreview, setTranscriptPreview] = useState("");
  const [pendingIntents, setPendingIntents] = useState([]);
  const [pendingTranscript, setPendingTranscript] = useState("");

  const recorderRef = useRef(null);
  const streamRef = useRef(null);
  const chunksRef = useRef([]);
  const cancelledRef = useRef(false);

  const isRecording = status === "recording";
  const isBusy = status === "processing" || status === "parsing" || status === "executing";

  useEffect(() => {
    if (!isModalOpen) return undefined;

    const handleKeyDown = (event) => {
      if (event.key === "Escape") closeModal();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isModalOpen, isBusy, isRecording]);

  const openModal = () => {
    cancelledRef.current = false;
    setTranscriptPreview("");
    setPendingIntents([]);
    setPendingTranscript("");
    setStatus("idle");
    setIsModalOpen(true);
    navigator.mediaDevices
      .getUserMedia({ audio: true })
      .then((stream) => stream.getTracks().forEach((t) => t.stop()))
      .catch(() => setStatus("error"));
  };

  const closeModal = () => {
    cancelledRef.current = true;
    if (isRecording) {
      recorderRef.current?.stop();
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setStatus("idle");
    setPendingIntents([]);
    setIsModalOpen(false);
  };

  const startRecording = async () => {
    if (isRecording || isBusy) return;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      streamRef.current = stream;
      recorderRef.current = recorder;
      chunksRef.current = [];

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };

      recorder.onstop = async () => {
        if (cancelledRef.current) return;

        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        if (!blob.size) {
          setStatus("idle");
          onError?.("录音内容为空，请重试");
          return;
        }

        // 第一步：STT，快速显示转写
        setStatus("processing");
        let transcript = "";
        try {
          const sttResult = await transcribeAudio(blob);
          if (cancelledRef.current) return;
          transcript = sttResult.data?.transcript || "";
          setTranscriptPreview(transcript);
          setPendingTranscript(transcript);
        } catch (error) {
          if (cancelledRef.current) return;
          setStatus("error");
          onError?.(getErrorMessage(error), error.response?.data?.data);
          return;
        }

        // 第二步：LLM 解析意图列表
        setStatus("parsing");
        try {
          const parseResult = await parseVoiceIntent(transcript);
          if (cancelledRef.current) return;
          const intents = parseResult.data?.intents || [];

          if (intents.length === 0) {
            setStatus("done");
            return;
          }

          if (!needsConfirm(intents)) {
            setStatus("executing");
            const result = await confirmVoiceIntent(intents, transcript);
            if (cancelledRef.current) return;
            onResult?.(result);
            setStatus("done");
            return;
          }

          setPendingIntents(intents);
          setStatus("confirming");
        } catch (error) {
          if (cancelledRef.current) return;
          setStatus("error");
          onError?.(getErrorMessage(error), error.response?.data?.data);
        }
      };

      recorder.start();
      setTranscriptPreview("");
      setPendingIntents([]);
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

  const handleConfirm = async () => {
    if (!pendingIntents.length) return;
    setStatus("executing");
    try {
      const result = await confirmVoiceIntent(pendingIntents, pendingTranscript);
      onResult?.(result);
      setStatus("done");
      setPendingIntents([]);
    } catch (error) {
      setStatus("error");
      onError?.(getErrorMessage(error), error.response?.data?.data);
    }
  };

  const handleCancel = () => {
    setPendingIntents([]);
    setStatus("idle");
  };

  const helperText = (() => {
    if (isRecording) return null;
    if (status === "processing") return "正在识别语音...";
    if (status === "parsing") return "正在解析意图...";
    if (status === "executing") return "正在执行...";
    if (status === "done") return pendingIntents.length === 0 && transcriptPreview
      ? "未识别到日历相关操作，可重新录音。"
      : "已完成，可关闭窗口或继续录音。";
    if (status === "error") return "出现错误，请重试或检查麦克风权限。";
    return "点击话筒开始录音，再次点击停止。";
  })();

  return (
    <>
      <button className="voice-trigger" onClick={openModal} type="button" aria-label="打开语音录入">
        <span className="voice-trigger-icon">🎤</span>
      </button>

      {isModalOpen
        ? createPortal(
            <div className="modal-overlay" onClick={closeModal} role="presentation">
              <div className="voice-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
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
                      isBusy ? "voice-button-processing" : "",
                    ].join(" ")}
                    onClick={isRecording ? stopRecording : startRecording}
                    disabled={isBusy || status === "confirming"}
                    type="button"
                  >
                    {isBusy ? "⏳" : "🎤"}
                  </button>

                  <div className="voice-helper modal-helper">
                    {isRecording ? (
                      <>
                        <div className="wave" aria-hidden="true">
                          <span /><span /><span /><span />
                        </div>
                        <div>再次点击停止录音</div>
                      </>
                    ) : (
                      helperText
                    )}
                  </div>

                  <div className="detail-block modal-detail-block">
                    <label>最近转写</label>
                    <div className="detail-surface">{transcriptPreview || "暂无"}</div>
                  </div>

                  {status === "confirming" && pendingIntents.length > 0 ? (
                    <div className="voice-confirm-block">
                      <ul className="voice-confirm-list">
                        {pendingIntents.map((intent, i) => {
                          const text = buildConfirmText(intent);
                          return text ? (
                            <li key={i} className="voice-confirm-text">{text}</li>
                          ) : null;
                        })}
                      </ul>
                      <div className="voice-confirm-actions">
                        <button className="ghost-button" type="button" onClick={handleCancel}>
                          取消
                        </button>
                        <button className="primary-button" type="button" onClick={handleConfirm}>
                          确认执行
                        </button>
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
