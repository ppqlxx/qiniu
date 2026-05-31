import axios from "axios";

const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || "http://localhost:8000",
});

const unwrap = (response) => response.data;

export const getEvents = (params = { range: "this_week" }) =>
  api.get("/api/events", { params }).then(unwrap);

export const createEvent = (payload) =>
  api.post("/api/events", payload).then(unwrap);

export const deleteEvent = (id) =>
  api.delete(`/api/events/${id}`).then(unwrap);

export const postVoice = (audioBlob) => {
  const form = new FormData();
  form.append("audio", audioBlob, "recording.webm");
  return api.post("/api/voice", form).then(unwrap);
};

export const transcribeAudio = (audioBlob) => {
  const form = new FormData();
  form.append("audio", audioBlob, "recording.webm");
  return api.post("/api/voice/transcribe", form).then(unwrap);
};

export const parseVoiceIntent = (transcript) =>
  api.post("/api/voice/parse", { transcript }).then(unwrap);

export const confirmVoiceIntent = (intents, transcript, audioFilename) =>
  api.post("/api/voice/confirm", { intents, transcript, audio_filename: audioFilename || null }).then(unwrap);

export const executeVoiceIntent = (transcript) =>
  api.post("/api/voice/execute", { transcript }).then(unwrap);

export const getVoiceLogs = (limit = 20) =>
  api.get("/api/voice/logs", { params: { limit } }).then(unwrap);

export const getVoiceAudioUrl = (filename) =>
  `${api.defaults.baseURL}/api/voice/audio/${filename}`;

export const getErrorMessage = (error) =>
  error?.response?.data?.message ||
  error?.response?.data?.error ||
  error?.message ||
  "请求失败，请稍后重试";
