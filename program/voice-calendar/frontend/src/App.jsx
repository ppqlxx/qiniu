import { useCallback, useEffect, useRef, useState } from "react";
import { Calendar, dayjsLocalizer } from "react-big-calendar";
import dayjs from "dayjs";
import "react-big-calendar/lib/css/react-big-calendar.css";

import { deleteEvent, getErrorMessage, getEvents } from "./api";
import VoiceButton from "./components/VoiceButton";

const localizer = dayjsLocalizer(dayjs);

function toCalendarEvent(event) {
  return {
    id: event.id,
    title: event.title,
    start: new Date(event.start_time),
    end: new Date(event.end_time || event.start_time),
    raw: event,
  };
}

function toApiDateTime(value) {
  return dayjs(value).format("YYYY-MM-DDTHH:mm:ss");
}

function normalizeCalendarRange(range) {
  if (Array.isArray(range) && range.length > 0) {
    return { start: range[0], end: range[range.length - 1] };
  }
  if (range?.start && range?.end) {
    return { start: range.start, end: range.end };
  }
  return null;
}

function speak(text) {
  if (!text || !window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "zh-CN";
  window.speechSynthesis.speak(utterance);
}

function formatIntent(intent) {
  if (!intent) return "暂无";
  return JSON.stringify(intent, null, 2);
}

function formatEventLine(event) {
  return `${dayjs(event.start_time).format("MM-DD HH:mm")} · ${event.title}`;
}

export default function App() {
  const currentRangeRef = useRef(null);
  const remindedEventKeysRef = useRef(new Set());

  const [events, setEvents] = useState([]);
  const [banner, setBanner] = useState({
    type: "info",
    text: "按住麦克风按钮说话，例如“明天下午三点开组会”。",
  });
  const [lastTranscript, setLastTranscript] = useState("");
  const [lastIntent, setLastIntent] = useState(null);
  const [queryEvents, setQueryEvents] = useState([]);
  const [loadingEvents, setLoadingEvents] = useState(false);

  const fetchEvents = useCallback(async (rangeOverride) => {
    setLoadingEvents(true);
    try {
      const activeRange = rangeOverride ?? currentRangeRef.current;
      const params = activeRange
        ? {
            start: toApiDateTime(activeRange.start),
            end: toApiDateTime(activeRange.end),
          }
        : { range: "this_week" };

      const response = await getEvents(params);
      const items = response.data?.events ?? [];
      setEvents(items.map(toCalendarEvent));

      const responseRange = response.data?.range;
      if (responseRange?.start && responseRange?.end) {
        currentRangeRef.current = {
          start: new Date(responseRange.start),
          end: new Date(responseRange.end),
        };
      }
    } catch (error) {
      setBanner({ type: "error", text: getErrorMessage(error) });
    } finally {
      setLoadingEvents(false);
    }
  }, []);

  useEffect(() => {
    fetchEvents();
  }, [fetchEvents]);

  const checkReminders = useCallback(async () => {
    try {
      const response = await getEvents({
        start: toApiDateTime(dayjs().startOf("day")),
        end: toApiDateTime(dayjs().endOf("day")),
      });
      const items = response.data?.events ?? [];
      const now = dayjs();

      for (const event of items) {
        const start = dayjs(event.start_time);
        const diffSeconds = now.diff(start, "second");
        const reminderKey = `${event.id}-${event.start_time}`;

        if (diffSeconds >= 0 && diffSeconds < 60 && !remindedEventKeysRef.current.has(reminderKey)) {
          remindedEventKeysRef.current.add(reminderKey);
          const message = `提醒您，现在有 ${event.title}`;
          window.alert(message);
          speak(message);
        }
      }
    } catch {
      // 提醒轮询失败不打断主流程
    }
  }, []);

  useEffect(() => {
    checkReminders();
    const timer = window.setInterval(checkReminders, 60_000);
    return () => window.clearInterval(timer);
  }, [checkReminders]);

  const handleVoiceResult = async (result) => {
    setLastTranscript(result.data?.transcript || result.intent?.raw_text || "");
    setLastIntent(result.intent || null);
    setQueryEvents(result.data?.events || []);
    setBanner({ type: "success", text: result.message || "操作成功" });
    speak(result.message);
    await fetchEvents();
  };

  const handleVoiceError = (message, details) => {
    setBanner({ type: "error", text: message });
    if (details?.transcript) {
      setLastTranscript(details.transcript);
    }
    if (details?.intent) {
      setLastIntent(details.intent);
    }
  };

  const handleSelectEvent = async (event) => {
    if (!window.confirm(`确认删除事件「${event.title}」吗？`)) {
      return;
    }

    try {
      const response = await deleteEvent(event.id);
      setBanner({ type: "success", text: response.message || "事件已删除" });
      speak(response.message);
      await fetchEvents();
    } catch (error) {
      setBanner({ type: "error", text: getErrorMessage(error) });
    }
  };

  const handleRangeChange = (nextRange) => {
    const normalized = normalizeCalendarRange(nextRange);
    if (!normalized) return;
    currentRangeRef.current = normalized;
    fetchEvents(normalized);
  };

  return (
    <div className="page-shell">
      <header className="hero-card">
        <div>
          <p className="eyebrow">Voice Calendar MVP</p>
          <h1>语音日历工具</h1>
          <p className="hero-copy">
            用一句自然语言完成事件添加、查询、删除，并在到点时收到页面弹窗和语音提醒。
          </p>
        </div>
        <VoiceButton onResult={handleVoiceResult} onError={handleVoiceError} />
      </header>

      <section className={`banner banner-${banner.type}`}>
        <strong>{banner.type === "error" ? "异常" : banner.type === "success" ? "完成" : "提示"}</strong>
        <span>{banner.text}</span>
      </section>

      <main className="content-grid">
        <section className="panel panel-calendar">
          <div className="panel-header">
            <div>
              <h2>日历视图</h2>
              <p>点击事件可手动删除。当前框架默认按周展示，并按当前视图范围拉取数据。</p>
            </div>
            <button className="ghost-button" onClick={() => fetchEvents()}>
              {loadingEvents ? "刷新中..." : "刷新事件"}
            </button>
          </div>

          <Calendar
            className="calendar-widget"
            localizer={localizer}
            events={events}
            defaultView="week"
            style={{ height: 580 }}
            onSelectEvent={handleSelectEvent}
            onRangeChange={handleRangeChange}
            messages={{
              next: "下一段",
              previous: "上一段",
              today: "今天",
              month: "月",
              week: "周",
              day: "日",
              agenda: "列表",
            }}
          />
        </section>

        <aside className="side-stack">
          <section className="panel">
            <div className="panel-header">
              <div>
                <h2>最近一次语音结果</h2>
                <p>用于展示 Whisper 转写文本和 LLM 解析结果，方便联调与答辩说明。</p>
              </div>
            </div>
            <div className="detail-block">
              <label>转写文本</label>
              <div className="detail-surface">{lastTranscript || "暂无"}</div>
            </div>
            <div className="detail-block">
              <label>结构化意图</label>
              <pre className="code-surface">{formatIntent(lastIntent)}</pre>
            </div>
          </section>

          <section className="panel">
            <div className="panel-header">
              <div>
                <h2>查询结果摘要</h2>
                <p>当语音意图为 query 时，这里展示当前返回的事件列表。</p>
              </div>
            </div>
            {queryEvents.length > 0 ? (
              <ul className="result-list">
                {queryEvents.map((event) => (
                  <li key={`${event.id}-${event.start_time}`}>{formatEventLine(event)}</li>
                ))}
              </ul>
            ) : (
              <div className="empty-state">暂无查询结果，先试试“我这周有什么安排”。</div>
            )}
          </section>
        </aside>
      </main>
    </div>
  );
}
