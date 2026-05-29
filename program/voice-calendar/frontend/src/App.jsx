import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Calendar, dayjsLocalizer } from "react-big-calendar";
import dayjs from "dayjs";
import "react-big-calendar/lib/css/react-big-calendar.css";

import { createEvent, deleteEvent, getErrorMessage, getEvents } from "./api";
import VoiceButton from "./components/VoiceButton";

const localizer = dayjsLocalizer(dayjs);

const NAV_ITEMS = [
  { id: "calendar", icon: "📅", label: "小云日历" },
  { id: "today", icon: "☀️", label: "今天" },
  { id: "history", icon: "🕘", label: "历史" },
  { id: "settings", icon: "⚙️", label: "设置" },
];

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

function formatEventDetail(event) {
  if (!event) {
    return "将鼠标悬停在日历事件上，或点击事件查看详细时间安排。";
  }

  const start = dayjs(event.start_time).format("YYYY-MM-DD HH:mm");
  const end = event.end_time ? dayjs(event.end_time).format("YYYY-MM-DD HH:mm") : "未设置";
  const description = event.description?.trim() || "暂无备注";

  return `开始：${start}\n结束：${end}\n备注：${description}`;
}

function buildEventTooltip(event) {
  const start = dayjs(event.start).format("MM-DD HH:mm");
  const end = dayjs(event.end).format("MM-DD HH:mm");
  const description = event.raw.description?.trim() || "暂无备注";
  return `${event.title}\n${start} - ${end}\n${description}`;
}

function createEmptyEventForm() {
  return {
    title: "",
    start_time: "",
    end_time: "",
    description: "",
  };
}

export default function App() {
  const currentRangeRef = useRef(null);
  const remindedEventKeysRef = useRef(new Set());
  const calendarSectionRef = useRef(null);
  const historySectionRef = useRef(null);

  const [activeNav, setActiveNav] = useState("calendar");
  const [events, setEvents] = useState([]);
  const [statusMessage, setStatusMessage] = useState({ type: "info", text: "准备就绪" });
  const [lastTranscript, setLastTranscript] = useState("");
  const [lastIntent, setLastIntent] = useState(null);
  const [queryEvents, setQueryEvents] = useState([]);
  const [voiceHistory, setVoiceHistory] = useState([]);
  const [recentActions, setRecentActions] = useState([]);
  const [loadingEvents, setLoadingEvents] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [hoveredEvent, setHoveredEvent] = useState(null);
  const [currentView, setCurrentView] = useState("month");
  const [currentDate, setCurrentDate] = useState(new Date());
  const [showAddModal, setShowAddModal] = useState(false);
  const [newEvent, setNewEvent] = useState(createEmptyEventForm());

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
      setStatusMessage({ type: "error", text: getErrorMessage(error) });
    } finally {
      setLoadingEvents(false);
    }
  }, []);

  useEffect(() => {
    fetchEvents();
  }, [fetchEvents]);

  const addRecentAction = useCallback((text) => {
    const action = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      time: dayjs().format("HH:mm:ss"),
      text,
    };
    setRecentActions((previous) => [action, ...previous].slice(0, 6));
  }, []);

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
          addRecentAction(message);
        }
      }
    } catch {
      // 提醒轮询失败不打断主流程。
    }
  }, [addRecentAction]);

  useEffect(() => {
    checkReminders();
    const timer = window.setInterval(checkReminders, 60_000);
    return () => window.clearInterval(timer);
  }, [checkReminders]);

  const todayEvents = useMemo(
    () => events.filter((event) => dayjs(event.start).isSame(dayjs(), "day")),
    [events],
  );

  const focusEvent = hoveredEvent ?? selectedEvent;

  const recordVoiceHistory = useCallback((result, type) => {
    const entry = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      time: dayjs().format("MM-DD HH:mm:ss"),
      transcript: result.data?.transcript || result.intent?.raw_text || "暂无转写",
      message: result.message || "暂无结果说明",
      action: result.intent?.action || type,
    };

    setVoiceHistory((previous) => [entry, ...previous].slice(0, 8));
    addRecentAction(result.message || "完成语音操作");
  }, [addRecentAction]);

  const handleVoiceResult = async (result) => {
    setLastTranscript(result.data?.transcript || result.intent?.raw_text || "");
    setLastIntent(result.intent || null);
    setQueryEvents(result.data?.events || []);
    setStatusMessage({ type: "success", text: result.message || "操作成功" });
    recordVoiceHistory(result, "success");
    speak(result.message);
    await fetchEvents();
  };

  const handleVoiceError = (message, details) => {
    setStatusMessage({ type: "error", text: message });
    if (details?.transcript) {
      setLastTranscript(details.transcript);
    }
    if (details?.intent) {
      setLastIntent(details.intent);
    }

    setVoiceHistory((previous) => [
      {
        id: `${Date.now()}-error`,
        time: dayjs().format("MM-DD HH:mm:ss"),
        transcript: details?.transcript || "暂无转写",
        message,
        action: "error",
      },
      ...previous,
    ].slice(0, 8));
    addRecentAction(message);
  };

  const handleDeleteSelected = async () => {
    if (!selectedEvent) return;
    if (!window.confirm(`确认删除事件「${selectedEvent.title}」吗？`)) {
      return;
    }

    try {
      const response = await deleteEvent(selectedEvent.id);
      setStatusMessage({ type: "success", text: response.message || "事件已删除" });
      setSelectedEvent(null);
      addRecentAction(response.message || "事件已删除");
      speak(response.message);
      await fetchEvents();
    } catch (error) {
      setStatusMessage({ type: "error", text: getErrorMessage(error) });
    }
  };

  const handleSelectEvent = (event) => {
    setSelectedEvent(event.raw);
  };

  const handleRangeChange = (nextRange) => {
    const normalized = normalizeCalendarRange(nextRange);
    if (!normalized) return;
    currentRangeRef.current = normalized;
    fetchEvents(normalized);
  };

  const handleSelectSlot = ({ start, end }) => {
    setShowAddModal(true);
    setNewEvent({
      title: "",
      start_time: dayjs(start).format("YYYY-MM-DDTHH:mm"),
      end_time: dayjs(end).format("YYYY-MM-DDTHH:mm"),
      description: "",
    });
  };

  const handleCreateEvent = async () => {
    if (!newEvent.title.trim() || !newEvent.start_time) {
      setStatusMessage({ type: "error", text: "请填写事件标题和开始时间" });
      return;
    }

    try {
      const payload = {
        title: newEvent.title.trim(),
        start_time: dayjs(newEvent.start_time).format("YYYY-MM-DDTHH:mm:ss"),
        end_time: newEvent.end_time
          ? dayjs(newEvent.end_time).format("YYYY-MM-DDTHH:mm:ss")
          : null,
        description: newEvent.description.trim(),
      };
      const response = await createEvent(payload);
      setShowAddModal(false);
      setNewEvent(createEmptyEventForm());
      setStatusMessage({ type: "success", text: response.message || "事件已创建" });
      addRecentAction(response.message || `创建事件：${payload.title}`);
      await fetchEvents();
    } catch (error) {
      setStatusMessage({ type: "error", text: getErrorMessage(error) });
    }
  };

  const handleNavAction = (itemId) => {
    setActiveNav(itemId);

    if (itemId === "today") {
      setCurrentDate(new Date());
      setCurrentView("day");
      currentRangeRef.current = null;
      fetchEvents({ start: dayjs().startOf("day").toDate(), end: dayjs().endOf("day").toDate() });
      return;
    }

    if (itemId === "history") {
      historySectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }

    if (itemId === "calendar") {
      setCurrentView("month");
      calendarSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }

    if (itemId === "settings") {
      setStatusMessage({ type: "info", text: "设置面板将在后续版本中补充" });
    }
  };

  const CalendarEvent = ({ event, title }) => (
    <div
      className="calendar-event-inner"
      title={buildEventTooltip(event)}
      onMouseEnter={() => setHoveredEvent(event.raw)}
      onMouseLeave={() => setHoveredEvent(null)}
    >
      {title}
    </div>
  );

  return (
    <div className="page-shell">
      <div className="app-shell">
        <aside className="app-sidebar">
          <div className="sidebar-brand">
            <span className="sidebar-brand-icon">☁️</span>
            <div>
              <strong>小云</strong>
              <span>日历</span>
            </div>
          </div>

          <nav className="sidebar-nav">
            {NAV_ITEMS.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`sidebar-nav-item${activeNav === item.id ? " is-active" : ""}`}
                onClick={() => handleNavAction(item.id)}
              >
                <span>{item.icon}</span>
                <span>{item.label}</span>
              </button>
            ))}
          </nav>

          <section className="sidebar-panel" ref={historySectionRef}>
            <div className="sidebar-panel-header">
              <h2>历史语音</h2>
              <span>{voiceHistory.length} 条</span>
            </div>
            {voiceHistory.length > 0 ? (
              <ul className="history-list">
                {voiceHistory.map((item) => (
                  <li key={item.id}>
                    <div className="history-meta">
                      <span>{item.time}</span>
                      <span>{item.action}</span>
                    </div>
                    <strong>{item.transcript}</strong>
                    <p>{item.message}</p>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="sidebar-empty">暂无历史语音记录</div>
            )}
          </section>

          <section className="sidebar-panel">
            <div className="sidebar-panel-header">
              <h2>查询结果摘要</h2>
              <span>{queryEvents.length} 项</span>
            </div>
            {queryEvents.length > 0 ? (
              <ul className="summary-list">
                {queryEvents.map((event) => (
                  <li key={`${event.id}-${event.start_time}`}>{formatEventLine(event)}</li>
                ))}
              </ul>
            ) : (
              <div className="sidebar-empty">最近一次语音查询还没有返回事件</div>
            )}
          </section>

          <section className="sidebar-panel recent-panel">
            <div className="sidebar-panel-header">
              <h2>最近操作</h2>
            </div>
            {recentActions.length > 0 ? (
              <ul className="recent-list">
                {recentActions.map((item) => (
                  <li key={item.id}>
                    <span>{item.time}</span>
                    <p>{item.text}</p>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="sidebar-empty">暂无最近操作</div>
            )}
          </section>
        </aside>

        <div className="app-main">
          <header className="topbar">
            <div className="topbar-left">
              <h1>小云日历</h1>
              <span>{dayjs(currentDate).format("YYYY年MM月DD日 dddd")}</span>
            </div>

            <div className="topbar-center">
              <VoiceButton onResult={handleVoiceResult} onError={handleVoiceError} />
            </div>

            <div className="topbar-right">
              <button className="primary-button" onClick={() => setShowAddModal(true)} type="button">
                + 新建
              </button>
              <div className="view-switcher">
                {[
                  { key: "month", label: "月" },
                  { key: "week", label: "周" },
                  { key: "day", label: "日" },
                ].map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    className={currentView === item.key ? "is-active" : ""}
                    onClick={() => setCurrentView(item.key)}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>
          </header>

          <div className={`status-strip status-${statusMessage.type}`}>
            <span className="status-label">当前状态</span>
            <span>{statusMessage.text}</span>
          </div>

          <div className="workspace">
            <section className="calendar-stage panel" ref={calendarSectionRef}>
              <Calendar
                className="calendar-widget"
                localizer={localizer}
                events={events}
                view={currentView}
                date={currentDate}
                onView={setCurrentView}
                onNavigate={setCurrentDate}
                style={{ height: "100%" }}
                onSelectEvent={handleSelectEvent}
                onRangeChange={handleRangeChange}
                onSelectSlot={handleSelectSlot}
                selectable
                tooltipAccessor={(event) => buildEventTooltip(event)}
                components={{ event: CalendarEvent }}
                toolbar={false}
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

            <aside className="detail-panel panel">
              <section>
                <div className="detail-header">
                  <h2>事件详情</h2>
                  <button
                    className="ghost-button danger-button"
                    onClick={handleDeleteSelected}
                    type="button"
                    disabled={!selectedEvent}
                  >
                    删除事件
                  </button>
                </div>
                <div className="detail-block">
                  <label>标题</label>
                  <div className="detail-surface">{focusEvent?.title || "暂无选中事件"}</div>
                </div>
                <div className="detail-block">
                  <label>时间安排</label>
                  <pre className="code-surface detail-code">{formatEventDetail(focusEvent)}</pre>
                </div>
                <div className="detail-block">
                  <label>最近一次结构化意图</label>
                  <pre className="code-surface">{formatIntent(lastIntent)}</pre>
                </div>
                <div className="detail-block">
                  <label>最近一次转写文本</label>
                  <div className="detail-surface">{lastTranscript || "暂无"}</div>
                </div>
              </section>

              <section className="today-panel">
                <div className="detail-header">
                  <h2>今日安排</h2>
                  <span>{todayEvents.length} 项</span>
                </div>
                {todayEvents.length > 0 ? (
                  <ul className="today-list">
                    {todayEvents.map((event) => (
                      <li key={event.id} onClick={() => setSelectedEvent(event.raw)}>
                        <span className="today-dot" />
                        <div>
                          <strong>{event.title}</strong>
                          <span>{dayjs(event.start).format("HH:mm")}</span>
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="sidebar-empty">今天还没有事件安排</div>
                )}
              </section>
            </aside>
          </div>
        </div>
      </div>

      {showAddModal ? (
        <div className="modal-overlay" onClick={() => setShowAddModal(false)} role="presentation">
          <div className="create-modal panel" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true">
            <div className="detail-header">
              <h2>新建事件</h2>
              <button className="modal-close" type="button" onClick={() => setShowAddModal(false)}>
                ×
              </button>
            </div>

            <div className="create-form">
              <label>
                <span>事件标题</span>
                <input
                  type="text"
                  value={newEvent.title}
                  onChange={(event) => setNewEvent((prev) => ({ ...prev, title: event.target.value }))}
                  placeholder="例如：团队周会"
                />
              </label>

              <label>
                <span>开始时间</span>
                <input
                  type="datetime-local"
                  value={newEvent.start_time}
                  onChange={(event) => setNewEvent((prev) => ({ ...prev, start_time: event.target.value }))}
                />
              </label>

              <label>
                <span>结束时间</span>
                <input
                  type="datetime-local"
                  value={newEvent.end_time}
                  onChange={(event) => setNewEvent((prev) => ({ ...prev, end_time: event.target.value }))}
                />
              </label>

              <label>
                <span>备注说明</span>
                <textarea
                  value={newEvent.description}
                  onChange={(event) => setNewEvent((prev) => ({ ...prev, description: event.target.value }))}
                  placeholder="可选"
                  rows={4}
                />
              </label>
            </div>

            <div className="modal-actions">
              <button className="ghost-button" type="button" onClick={() => setShowAddModal(false)}>
                取消
              </button>
              <button className="primary-button" type="button" onClick={handleCreateEvent}>
                保存事件
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
