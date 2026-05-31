import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Calendar, dayjsLocalizer } from "react-big-calendar";
import dayjs from "dayjs";
import weekOfYear from "dayjs/plugin/weekOfYear";
import "react-big-calendar/lib/css/react-big-calendar.css";

dayjs.extend(weekOfYear);

import { createEvent, deleteEvent, getActionLogs, getBrief, getErrorMessage, getEvents, getSettings, getStatistics, getVoiceAudioUrl, getVoiceLogs, logAction } from "./api";
import SettingsPanel from "./components/SettingsPanel";
import VoiceButton from "./components/VoiceButton";
import { useWeather } from "./components/Weather";

const localizer = dayjsLocalizer(dayjs);
const TIME_GRID_STEP_MINUTES = 60;
const TIME_GRID_SLOTS_PER_GROUP = 1;
const MONTH_LABELS = Array.from({ length: 12 }, (_, index) => `${index + 1}月`);
const WEEKDAY_LABELS = ["日", "一", "二", "三", "四", "五", "六"];

const NAV_ITEMS = [
  { id: "calendar", icon: "📅", label: "小云日历" },
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

function speak(text, { rate = 1, volume = 1, lang = "zh-CN" } = {}) {
  if (!text || !window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = lang;
  utterance.rate = rate;
  utterance.volume = volume;
  window.speechSynthesis.speak(utterance);
}

function buildEventTooltip(event) {
  const start = dayjs(event.start).format("MM-DD HH:mm");
  const end = dayjs(event.end).format("MM-DD HH:mm");
  const description = event.raw.description?.trim() || "暂无备注";
  return `${event.title}\n${start} - ${end}\n${description}`;
}

function formatHistoryLine(event) {
  return `${dayjs(event.start_time).format("MM-DD HH:mm")} · ${event.title}`;
}

function formatEventDetail(event) {
  if (!event) return "暂无事件详情";

  const start = dayjs(event.start_time).format("YYYY-MM-DD HH:mm");
  const end = event.end_time ? dayjs(event.end_time).format("YYYY-MM-DD HH:mm") : "未设置";
  const description = event.description?.trim() || "暂无备注";

  return `开始：${start}\n结束：${end}\n备注：${description}`;
}

function formatIntent(intent) {
  if (!intent) return "暂无";
  return JSON.stringify(intent, null, 2);
}

function createEmptyEventForm() {
  return {
    title: "",
    start_time: "",
    end_time: "",
    description: "",
  };
}

function sameDate(left, right) {
  return dayjs(left).isSame(dayjs(right), "day");
}

function formatViewHeading(view, date) {
  if (view === "year") {
    return dayjs(date).format("YYYY年");
  }

  if (view === "agenda") {
    const d = dayjs(date);
    const weekInMonth = Math.ceil((d.date() + d.startOf("month").day()) / 7);
    return `${d.month() + 1}月第${weekInMonth}周`;
  }

  return dayjs(date).format("YYYY年MM月");
}

function getRangeForCalendarView(view, date) {
  const point = dayjs(date);

  if (view === "year") {
    return {
      start: point.startOf("year").startOf("week").toDate(),
      end: point.endOf("year").endOf("week").toDate(),
    };
  }

  if (view === "agenda") {
    return {
      start: point.startOf("week").toDate(),
      end: point.endOf("week").toDate(),
    };
  }

  return {
    start: point.startOf("month").startOf("week").toDate(),
    end: point.endOf("month").endOf("week").toDate(),
  };
}

function createYearMonthCells(monthDate) {
  const first = monthDate.startOf("month").startOf("week");
  const last = monthDate.endOf("month").endOf("week");
  const cells = [];
  let cursor = first;

  while (cursor.isBefore(last) || cursor.isSame(last, "day")) {
    cells.push(cursor);
    cursor = cursor.add(1, "day");
  }

  return cells;
}

function WeekAgendaTable({ events, currentDate, onSelectEvent }) {
  const weekStart = dayjs(currentDate).startOf("week");
  const today = dayjs();

  const rows = Array.from({ length: 7 }, (_, i) => weekStart.add(i, "day")).flatMap((day) => {
    const dateKey = day.format("YYYY-MM-DD");
    const isToday = day.isSame(today, "day");
    const dayEvents = events
      .filter((e) => dayjs(e.start).isSame(day, "day"))
      .sort((a, b) => new Date(a.start) - new Date(b.start));

    if (dayEvents.length === 0) {
      return [
        <tr key={dateKey} className="week-agenda-row">
          <td className={`week-agenda-date${isToday ? " is-today" : ""}`}>
            <span className="week-agenda-day-num">{day.format("DD")}</span>
            <span className="week-agenda-day-label">{WEEKDAY_LABELS[day.day()]}</span>
          </td>
          <td className="week-agenda-time" />
          <td className="week-agenda-event week-agenda-empty">暂无事件</td>
        </tr>,
      ];
    }

    return dayEvents.map((event, idx) => (
      <tr key={`${dateKey}-${idx}`} className="week-agenda-row">
        {idx === 0 && (
          <td
            className={`week-agenda-date${isToday ? " is-today" : ""}`}
            rowSpan={dayEvents.length}
          >
            <span className="week-agenda-day-num">{day.format("DD")}</span>
            <span className="week-agenda-day-label">{WEEKDAY_LABELS[day.day()]}</span>
          </td>
        )}
        <td className="week-agenda-time">{dayjs(event.start).format("HH:mm")}</td>
        <td className="week-agenda-event">
          <div className="agenda-event-inner" onClick={() => onSelectEvent(event)}>
            <span className="agenda-event-dot" />
            <span className="agenda-event-title">{event.title}</span>
            {event.raw?.description && (
              <span className="agenda-event-desc">{event.raw.description}</span>
            )}
          </div>
        </td>
      </tr>
    ));
  });

  return (
    <table className="week-agenda-table">
      <thead>
        <tr>
          <th className="week-agenda-th">日期</th>
          <th className="week-agenda-th">时间</th>
          <th className="week-agenda-th">事件</th>
        </tr>
      </thead>
      <tbody>{rows}</tbody>
    </table>
  );
}

export default function App() {
  const currentRangeRef = useRef(null);
  const remindedEventKeysRef = useRef(new Set());
  const calendarSectionRef = useRef(null);

  const [settings, setSettings] = useState({
    voice_language: "zh",
    tts_rate: 1.0,
    tts_volume: 1.0,
    voice_reminder_enabled: true,
    reminder_advance_seconds: 60,
    browser_notification_enabled: false,
    temperature_unit: "celsius",
    city: "",
    theme: "light",
    voice_history_limit: 20,
    action_history_limit: 20,
  });
  const [statsPeriod, setStatsPeriod] = useState("week");
  const [statsData, setStatsData] = useState(null);

  const { icon: weatherIcon, tempText } = useWeather({
    temperatureUnit: settings.temperature_unit,
    city: settings.city,
  });

  const [pageMode, setPageMode] = useState("calendar");
  const [activeNav, setActiveNav] = useState("calendar");
  const [events, setEvents] = useState([]);
  const [statusMessage, setStatusMessage] = useState({ type: "info", text: "准备就绪" });
  const [lastTranscript, setLastTranscript] = useState("");
  const [lastIntent, setLastIntent] = useState(null);
  const [queryEvents, setQueryEvents] = useState([]);
  const [voiceHistory, setVoiceHistory] = useState([]);
  const [recentActions, setRecentActions] = useState([]);
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [hoveredEvent, setHoveredEvent] = useState(null);
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [eventForm, setEventForm] = useState(createEmptyEventForm());
  const [loadingEvents, setLoadingEvents] = useState(false);
  const [currentView, setCurrentView] = useState("month");
  const [currentDate, setCurrentDate] = useState(new Date());
  const [showAddModal, setShowAddModal] = useState(false);
  const [newEvent, setNewEvent] = useState(createEmptyEventForm());
  const [briefLoading, setBriefLoading] = useState(false);

  useEffect(() => {
    getSettings()
      .then((res) => {
        if (res.data) setSettings(res.data);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    document.body.dataset.theme = settings.theme;
  }, [settings.theme]);

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

  useEffect(() => {
    getVoiceLogs(settings.voice_history_limit)
      .then((res) => {
        const logs = res.data?.logs ?? [];
        setVoiceHistory(
          logs.map((log) => ({
            id: String(log.id),
            time: dayjs(log.created_at).format("MM-DD HH:mm:ss"),
            transcript: log.transcript || "暂无转写",
            message: log.result_msg || "暂无结果",
            action: log.action || "unknown",
            audio_file: log.audio_file || null,
          }))
        );
      })
      .catch(() => {});
  }, [settings.voice_history_limit]);

  useEffect(() => {
    getActionLogs(settings.action_history_limit)
      .then((res) => {
        const logs = res.data?.logs ?? [];
        setRecentActions(
          logs.map((log) => ({
            id: String(log.id),
            time: dayjs(log.created_at).format("HH:mm:ss"),
            text: log.text,
          }))
        );
      })
      .catch(() => {});
  }, [settings.action_history_limit]);

  useEffect(() => {
    if (pageMode !== "history") return;
    getStatistics(statsPeriod)
      .then((res) => setStatsData(res.data ?? null))
      .catch(() => {});
  }, [pageMode, statsPeriod]);

  useEffect(() => {
    if (!selectedEvent) {
      setEventForm(createEmptyEventForm());
      return;
    }

    setEventForm({
      title: selectedEvent.title,
      start_time: dayjs(selectedEvent.start_time).format("YYYY-MM-DDTHH:mm"),
      end_time: selectedEvent.end_time ? dayjs(selectedEvent.end_time).format("YYYY-MM-DDTHH:mm") : "",
      description: selectedEvent.description || "",
    });
  }, [selectedEvent]);

  const addRecentAction = useCallback((text) => {
    const action = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      time: dayjs().format("HH:mm:ss"),
      text,
    };
    setRecentActions((previous) => [action, ...previous].slice(0, 20));
    logAction(text).catch(() => {});
  }, []);

  const checkReminders = useCallback(async () => {
    try {
      const response = await getEvents({
        start: toApiDateTime(dayjs().startOf("day")),
        end: toApiDateTime(dayjs().endOf("day")),
      });
      const items = response.data?.events ?? [];
      const now = dayjs();
      const windowSeconds = settings.reminder_advance_seconds;

      for (const event of items) {
        const start = dayjs(event.start_time);
        const diffSeconds = now.diff(start, "second");
        const reminderKey = `${event.id}-${event.start_time}`;

        if (diffSeconds >= 0 && diffSeconds < windowSeconds && !remindedEventKeysRef.current.has(reminderKey)) {
          remindedEventKeysRef.current.add(reminderKey);
          const message = `提醒您，现在有 ${event.title}`;
          if (settings.browser_notification_enabled && Notification.permission === "granted") {
            new Notification("小云日历提醒", { body: message });
          } else {
            window.alert(message);
          }
          if (settings.voice_reminder_enabled) speak(message, { rate: settings.tts_rate, volume: settings.tts_volume, lang: settings.voice_language === "en" ? "en-US" : "zh-CN" });
          addRecentAction(message);
        }
      }
    } catch {
      // 提醒轮询失败不打断主流程。
    }
  }, [addRecentAction, settings.reminder_advance_seconds, settings.browser_notification_enabled, settings.voice_reminder_enabled]);

  useEffect(() => {
    checkReminders();
    const timer = window.setInterval(checkReminders, 60_000);
    return () => window.clearInterval(timer);
  }, [checkReminders]);

  const selectedDateEvents = useMemo(
    () => events.filter((event) => sameDate(event.start, selectedDate)),
    [events, selectedDate],
  );

  const currentYear = dayjs(currentDate).year();
  const currentMonth = dayjs(currentDate).month();
  const yearOptions = useMemo(
    () => Array.from({ length: 11 }, (_, index) => currentYear - 5 + index),
    [currentYear],
  );
  const currentViewHeading = useMemo(
    () => formatViewHeading(currentView, currentDate),
    [currentDate, currentView],
  );
  const calendarFormats = useMemo(
    () => ({
      dayRangeHeaderFormat: ({ start, end }) =>
        `${dayjs(start).format("MM月DD日")} - ${dayjs(end).format("MM月DD日")}`,
      timeGutterFormat: (date) => dayjs(date).format("HH:mm"),
    }),
    [],
  );
  const yearEventCounts = useMemo(() => {
    const counts = new Map();
    events.forEach((event) => {
      const key = dayjs(event.start).format("YYYY-MM-DD");
      counts.set(key, (counts.get(key) || 0) + 1);
    });
    return counts;
  }, [events]);
  const yearViewMonths = useMemo(
    () =>
      Array.from({ length: 12 }, (_, monthIndex) => {
        const monthDate = dayjs(currentDate).year(currentYear).month(monthIndex).startOf("month");
        return {
          monthIndex,
          monthDate,
          monthLabel: MONTH_LABELS[monthIndex],
          cells: createYearMonthCells(monthDate),
        };
      }),
    [currentDate, currentYear],
  );

  const focusEvent = hoveredEvent ?? selectedEvent;

  const recordVoiceHistory = useCallback((result, type) => {
    const entry = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      time: dayjs().format("MM-DD HH:mm:ss"),
      transcript: result.data?.transcript || result.intent?.raw_text || "暂无转写",
      message: result.message || "暂无结果说明",
      action: result.intent?.action || type,
      audio_file: result.data?.audio_filename || null,
    };

    setVoiceHistory((previous) => [entry, ...previous].slice(0, 20));
    addRecentAction(result.message || "完成语音操作");
  }, [addRecentAction]);

  const syncCalendarContext = useCallback((view, date) => {
    const nextDate = new Date(date);
    setCurrentView(view);
    setCurrentDate(nextDate);
    setSelectedDate(nextDate);
    const nextRange = getRangeForCalendarView(view, nextDate);
    currentRangeRef.current = nextRange;
    fetchEvents(nextRange);
  }, [fetchEvents]);

  const handleVoiceResult = async (result) => {
    setLastTranscript(result.data?.transcript || result.intent?.raw_text || "");
    setLastIntent(result.intent || null);
    setQueryEvents(result.data?.events || []);
    setStatusMessage({ type: "success", text: result.message || "操作成功" });
    recordVoiceHistory(result, "success");
    speak(result.message, { rate: settings.tts_rate, volume: settings.tts_volume, lang: settings.voice_language === "en" ? "en-US" : "zh-CN" });

    const intent = result.intent;

    if (intent?.action === "query" && intent?.query_range?.start) {
      // 跳转到查询日期范围，切换到周视图方便查看事件时间
      const targetDate = new Date(intent.query_range.start);
      syncCalendarContext("agenda", targetDate);
      setSelectedDate(targetDate);
      // 有事件则选中第一条，右侧面板展示详情
      const firstEvent = result.data?.events?.[0];
      if (firstEvent) setSelectedEvent(firstEvent);
      return;
    }

    if (intent?.action === "add" && result.data?.event) {
      // 跳转到新建事件所在日期并选中
      const event = result.data.event;
      const targetDate = new Date(event.start_time);
      syncCalendarContext("agenda", targetDate);
      setSelectedDate(targetDate);
      setSelectedEvent(event);
      return;
    }

    await fetchEvents(currentRangeRef.current);
  };

  const handleVoiceError = (message, details) => {
    setStatusMessage({ type: "error", text: message });
    if (details?.transcript) {
      setLastTranscript(details.transcript);
    }
    if (details?.intent) {
      setLastIntent(details.intent);
    }
    addRecentAction(message);
  };

  const handleSelectEvent = (event) => {
    setSelectedEvent(event.raw);
    setSelectedDate(new Date(event.start));
    if (currentView !== "agenda") {
      syncCalendarContext("agenda", new Date(event.start));
    }
  };

  const handleSelectSlot = ({ start }) => {
    setSelectedDate(new Date(start));
    setSelectedEvent(null);
  };

  const handleRangeChange = (nextRange) => {
    const normalized = normalizeCalendarRange(nextRange);
    if (!normalized) return;
    currentRangeRef.current = normalized;
    fetchEvents(normalized);
  };

  const handleYearChange = (event) => {
    const nextDate = dayjs(currentDate).year(Number(event.target.value)).toDate();
    syncCalendarContext(currentView, nextDate);
  };

  const handleMonthChange = (event) => {
    const nextDate = dayjs(currentDate).month(Number(event.target.value)).toDate();
    syncCalendarContext(currentView, nextDate);
  };

  const handleViewChange = (view) => {
    syncCalendarContext(view, currentDate);
  };

  const handleYearMonthCardClick = (monthDate) => {
    syncCalendarContext("month", monthDate.toDate());
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
      const createdEvent = response.data?.event;
      setShowAddModal(false);
      setNewEvent(createEmptyEventForm());
      setStatusMessage({ type: "success", text: response.message || "事件已创建" });
      addRecentAction(response.message || `创建事件：${payload.title}`);
      if (createdEvent) {
        setSelectedEvent(createdEvent);
        setSelectedDate(new Date(createdEvent.start_time));
      }
      await fetchEvents(currentRangeRef.current);
    } catch (error) {
      setStatusMessage({ type: "error", text: getErrorMessage(error) });
    }
  };

  const handleUpdateSelected = async () => {
    if (!selectedEvent) return;
    if (!eventForm.title.trim() || !eventForm.start_time) {
      setStatusMessage({ type: "error", text: "请填写事件标题和开始时间" });
      return;
    }

    try {
      await deleteEvent(selectedEvent.id);
      const payload = {
        title: eventForm.title.trim(),
        start_time: dayjs(eventForm.start_time).format("YYYY-MM-DDTHH:mm:ss"),
        end_time: eventForm.end_time
          ? dayjs(eventForm.end_time).format("YYYY-MM-DDTHH:mm:ss")
          : null,
        description: eventForm.description.trim(),
      };
      const response = await createEvent(payload);
      const updatedEvent = response.data?.event;
      setStatusMessage({ type: "success", text: "事件详情已更新" });
      addRecentAction(`更新事件：${payload.title}`);
      if (updatedEvent) {
        setSelectedEvent(updatedEvent);
        setSelectedDate(new Date(updatedEvent.start_time));
      }
      await fetchEvents(currentRangeRef.current);
    } catch (error) {
      setStatusMessage({ type: "error", text: getErrorMessage(error) });
    }
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
      setHoveredEvent(null);
      addRecentAction(response.message || "事件已删除");
      speak(response.message, { rate: settings.tts_rate, volume: settings.tts_volume, lang: settings.voice_language === "en" ? "en-US" : "zh-CN" });
      await fetchEvents(currentRangeRef.current);
    } catch (error) {
      setStatusMessage({ type: "error", text: getErrorMessage(error) });
    }
  };

  const handleNavAction = (itemId) => {
    setActiveNav(itemId);

    if (itemId === "calendar") {
      setPageMode("calendar");
      calendarSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }

    if (itemId === "history") {
      setPageMode("history");
      return;
    }

    if (itemId === "settings") {
      setPageMode("settings");
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

  const handleSettingsChange = useCallback((next) => {
    setSettings(next);
  }, []);

  const handleBriefPlay = useCallback(async () => {
    if (briefLoading) return;
    setBriefLoading(true);
    try {
      const today = dayjs();
      const weekStart = dayjs(currentDate).startOf("week");
      const weekEnd = dayjs(currentDate).endOf("week");
      const todayEvents = events.filter((e) => dayjs(e.start).isSame(today, "day"));
      const scope = todayEvents.length > 0 ? "今日及本周" : "本周";
      const payload = events
        .filter((e) => {
          const d = dayjs(e.start);
          return d.isAfter(weekStart.subtract(1, "ms")) && d.isBefore(weekEnd.add(1, "ms"));
        })
        .map((e) => ({
          title: e.title,
          start_time: e.raw.start_time,
          end_time: e.raw.end_time || null,
          description: e.raw.description || "",
        }));
      const res = await getBrief(payload, scope);
      const text = res.data?.text || "暂无播报内容";
      speak(text, {
        rate: settings.tts_rate,
        volume: settings.tts_volume,
        lang: settings.voice_language === "en" ? "en-US" : "zh-CN",
      });
    } catch {
      speak("播报生成失败，请稍后重试", { rate: settings.tts_rate, volume: settings.tts_volume });
    } finally {
      setBriefLoading(false);
    }
  }, [briefLoading, events, currentDate, settings]);

  return (
    <div className={`page-shell${pageMode === "history" || pageMode === "settings" ? " history-mode" : ""}`}>
      <aside className="layout-sidebar">
        <div className="sidebar-brand">
          <span className="sidebar-brand-icon">{weatherIcon}</span>
          <div>
            <strong>小云日历</strong>
            <span>{tempText}</span>
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
      </aside>

      <main className="layout-main">
        <header className="topbar">
          <div className="topbar-left">
            <h1>
              {pageMode === "history" ? "历史记录" : pageMode === "settings" ? "设置" : "小云日历"}
            </h1>
            <div className="topbar-date-row">
              {currentView === "agenda" && pageMode === "calendar" ? (
                <button type="button" className="date-nav-btn" onClick={() => syncCalendarContext("agenda", dayjs(currentDate).subtract(1, "week").toDate())} aria-label="上一周">‹</button>
              ) : null}
              <span>
                {pageMode === "history" ? "查看最近的语音记录与操作结果" :
                 pageMode === "settings" ? "自定义应用行为与外观" :
                 currentViewHeading}
              </span>
              {currentView === "agenda" && pageMode === "calendar" ? (
                <button type="button" className="date-nav-btn" onClick={() => syncCalendarContext("agenda", dayjs(currentDate).add(1, "week").toDate())} aria-label="下一周">›</button>
              ) : null}
            </div>
          </div>

          {pageMode === "calendar" ? (
            <>
              <div className="topbar-right">
                {currentView === "agenda" ? (
                  <button
                    type="button"
                    className={`brief-button${briefLoading ? " is-loading" : ""}`}
                    onClick={handleBriefPlay}
                    disabled={briefLoading}
                    title="播报本周日程"
                  >
                    {briefLoading ? "生成中…" : "📢 播报"}
                  </button>
                ) : null}
                <button className="primary-button topbar-primary-button" onClick={() => setShowAddModal(true)} type="button">
                  + 新建事件
                </button>
                <div className="date-switcher">
                  <select value={currentYear} onChange={handleYearChange} aria-label="选择年份">
                    {yearOptions.map((year) => (
                      <option key={year} value={year}>
                        {year}年
                      </option>
                    ))}
                  </select>
                  <select value={currentMonth} onChange={handleMonthChange} aria-label="选择月份">
                    {MONTH_LABELS.map((label, index) => (
                      <option key={label} value={index}>
                        {label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="view-switcher">
                  {[
                    { key: "year", label: "年" },
                    { key: "month", label: "月" },
                    { key: "agenda", label: "周" },
                  ].map((item) => (
                    <button
                      key={item.key}
                      type="button"
                      className={currentView === item.key ? "is-active" : ""}
                      onClick={() => handleViewChange(item.key)}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="topbar-spacer" />
              <div className="topbar-spacer" />
            </>
          )}
        </header>

        {pageMode === "calendar" ? (
          <div className={`status-strip status-${statusMessage.type}`}>
            <span className="status-label">当前状态</span>
            <span>{statusMessage.text}</span>
          </div>
        ) : null}
        {pageMode === "settings" ? (
          <div className={`status-strip status-info`}>
            <span className="status-label">提示</span>
            <span>修改会立即保存到服务器</span>
          </div>
        ) : null}

        {pageMode === "settings" ? (
          <section className="settings-main panel">
            <SettingsPanel settings={settings} onSettingsChange={handleSettingsChange} />
          </section>
        ) : null}

        {pageMode === "calendar" ? (
          <section className="calendar-panel panel" ref={calendarSectionRef}>
            <div className={`calendar-scroll calendar-scroll-${currentView}`}>
              {currentView === "year" ? (
                <div className="year-grid">
                  {yearViewMonths.map((month) => (
                    <button
                      key={month.monthIndex}
                      type="button"
                      className="year-card"
                      onClick={() => handleYearMonthCardClick(month.monthDate)}
                    >
                      <div className="year-card-header">
                        <strong>{month.monthLabel}</strong>
                      </div>
                      <div className="year-card-weekdays">
                        {WEEKDAY_LABELS.map((label) => (
                          <span key={label}>{label}</span>
                        ))}
                      </div>
                      <div className="year-card-days">
                        {month.cells.map((cell) => {
                          const dateKey = cell.format("YYYY-MM-DD");
                          const isCurrentMonth = cell.month() === month.monthIndex;
                          const hasEvent = Boolean(yearEventCounts.get(dateKey));

                          return (
                            <div
                              key={dateKey}
                              className={`year-card-day${isCurrentMonth ? "" : " is-muted"}${hasEvent ? " has-event" : ""}`}
                            >
                              <span>{cell.date()}</span>
                            </div>
                          );
                        })}
                      </div>
                    </button>
                  ))}
                </div>
              ) : currentView === "agenda" ? (
                <WeekAgendaTable
                  events={events}
                  currentDate={currentDate}
                  onSelectEvent={handleSelectEvent}
                />
              ) : (
                <Calendar
                  className="calendar-widget"
                  localizer={localizer}
                  events={events}
                  step={TIME_GRID_STEP_MINUTES}
                  timeslots={TIME_GRID_SLOTS_PER_GROUP}
                  formats={calendarFormats}
                  view={currentView}
                  date={currentDate}
                  onView={handleViewChange}
                  onNavigate={(date) => syncCalendarContext(currentView, date)}
                  style={{ height: 640 }}
                  onSelectEvent={handleSelectEvent}
                  onSelectSlot={handleSelectSlot}
                  selectable
                  onRangeChange={handleRangeChange}
                  tooltipAccessor={(event) => buildEventTooltip(event)}
                  components={{ event: CalendarEvent }}
                  toolbar={false}
                  messages={{
                    next: "下一段",
                    previous: "上一段",
                    today: "今天",
                    month: "月",
                    week: "周",
                    noEventsInRange: "当前时间范围暂无事件",
                  }}
                />
              )}
            </div>
          </section>
        ) : pageMode === "history" ? (
          <section className="history-main">
            <section className="history-main-card panel">
              <div className="history-main-header">
                <h2>历史语音</h2>
                <span>{voiceHistory.length} 条</span>
              </div>
              {voiceHistory.length > 0 ? (
                <ul className="history-list">
                  {voiceHistory.map((item) => (
                    <li key={item.id}>
                      <div className="history-meta">
                        <span>{item.time}</span>
                      </div>
                      <strong>{item.transcript}</strong>
                      <p>{item.message}</p>
                      {item.audio_file ? (
                        <audio
                          className="history-audio"
                          src={getVoiceAudioUrl(item.audio_file)}
                          controls
                          preload="none"
                        />
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="sidebar-empty">暂无历史语音记录</div>
              )}
            </section>

            <section className="history-main-card panel">
              <div className="history-main-header">
                <h2>最近操作</h2>
                <span>{recentActions.length} 条</span>
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

            {/* 活动统计 */}
            <section className="history-main-card panel">
              <div className="history-main-header">
                <h2>活动统计</h2>
                <div className="stats-period-tabs">
                  {[["week", "本周"], ["month", "本月"], ["year", "本年"]].map(([val, label]) => (
                    <button
                      key={val}
                      type="button"
                      className={`stats-period-btn${statsPeriod === val ? " is-active" : ""}`}
                      onClick={() => setStatsPeriod(val)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              {statsData ? (
                <div className="stats-grid">
                  <div className="stats-card">
                    <div className="stats-card-icon">📅</div>
                    <div className="stats-card-body">
                      <div className="stats-card-value">{statsData.events?.total ?? 0} 个事件</div>
                      <div className="stats-card-sub">
                        活跃 {statsData.events?.active_days ?? 0} 天
                        {statsData.events?.busiest_day
                          ? `　最忙 ${statsData.events.busiest_day.date.slice(5)}（${statsData.events.busiest_day.count} 个）`
                          : ""}
                      </div>
                    </div>
                  </div>
                  <div className="stats-card">
                    <div className="stats-card-icon">🎤</div>
                    <div className="stats-card-body">
                      <div className="stats-card-value">{statsData.voice_ops?.total ?? 0} 次语音</div>
                      <div className="stats-card-sub">
                        {[
                          statsData.voice_ops?.by_action?.add && `添加 ${statsData.voice_ops.by_action.add}`,
                          statsData.voice_ops?.by_action?.query && `查询 ${statsData.voice_ops.by_action.query}`,
                          statsData.voice_ops?.by_action?.delete && `删除 ${statsData.voice_ops.by_action.delete}`,
                        ].filter(Boolean).join("　") || "暂无操作"}
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="sidebar-empty">加载中…</div>
              )}
            </section>
          </section>
        ) : null}
      </main>

      {pageMode === "calendar" ? (
        <aside className="layout-detail panel">
          {!selectedEvent ? (
            <div className="empty-detail-state">
              <div className="empty-detail-illustration">🌱</div>
              <p className="empty-detail-hint">点击日历上的事件</p>
              <p className="empty-detail-hint-sub">在这里查看详情或编辑</p>

              <div className="today-schedule">
                <span className="today-schedule-label">
                  {dayjs(selectedDate).isSame(dayjs(), "day") ? "今日安排" : `${dayjs(selectedDate).format("MM月DD日")}安排`}
                </span>
                {selectedDateEvents.length === 0 ? (
                  <p className="today-schedule-empty">
                    {dayjs(selectedDate).isSame(dayjs(), "day") ? "今天暂无事件" : "当日暂无事件"}
                  </p>
                ) : (
                  <ul className="today-list">
                    {selectedDateEvents.map((event) => (
                      <li key={event.id} onClick={() => setSelectedEvent(event.raw)}>
                        <span className="today-dot" />
                        <div>
                          <strong>{event.title}</strong>
                          <span>{dayjs(event.start).format("HH:mm")}</span>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          ) : null}

          {selectedEvent ? (
            <>
              <section>
                <div className="detail-header">
                  <h2>事件详情</h2>
                  <button className="ghost-button danger-button" onClick={handleDeleteSelected} type="button">
                    删除事件
                  </button>
                </div>

                <div className="detail-block">
                  <label>详情预览</label>
                  <pre className="code-surface detail-code">{formatEventDetail(focusEvent)}</pre>
                </div>

                <div className="detail-block">
                  <label>事件标题</label>
                  <input
                    type="text"
                    value={eventForm.title}
                    onChange={(event) => setEventForm((prev) => ({ ...prev, title: event.target.value }))}
                  />
                </div>

                <div className="detail-block">
                  <label>开始时间</label>
                  <input
                    type="datetime-local"
                    value={eventForm.start_time}
                    onChange={(event) => setEventForm((prev) => ({ ...prev, start_time: event.target.value }))}
                  />
                </div>

                <div className="detail-block">
                  <label>结束时间</label>
                  <input
                    type="datetime-local"
                    value={eventForm.end_time}
                    onChange={(event) => setEventForm((prev) => ({ ...prev, end_time: event.target.value }))}
                  />
                </div>

                <div className="detail-block">
                  <label>备注</label>
                  <textarea
                    value={eventForm.description}
                    onChange={(event) => setEventForm((prev) => ({ ...prev, description: event.target.value }))}
                    rows={4}
                  />
                </div>

                <div className="detail-actions">
                  <button className="primary-button" type="button" onClick={handleUpdateSelected}>
                    保存修改
                  </button>
                </div>
              </section>

              <section className="today-panel">
                <div className="detail-header">
                  <h2>{dayjs(selectedDate).format("MM月DD日")}安排</h2>
                  <span>{selectedDateEvents.length} 项</span>
                </div>
                <ul className="today-list">
                  {selectedDateEvents.map((event) => (
                    <li key={event.id} onClick={() => setSelectedEvent(event.raw)}>
                      <span className="today-dot" />
                      <div>
                        <strong>{event.title}</strong>
                        <span>{dayjs(event.start).format("HH:mm")}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            </>
          ) : null}

        </aside>
      ) : null}

      {pageMode === "calendar" ? (
        <div className="voice-fab">
          <span className="voice-fab-tip">点击我添加代办事项喔</span>
          <VoiceButton onResult={handleVoiceResult} onError={handleVoiceError} />
        </div>
      ) : null}

      {showAddModal ? (
        <div className="modal-overlay" onClick={() => setShowAddModal(false)} role="presentation">
          <div className="create-modal panel" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true">
            <div className="detail-header">
              <h2>新建事件</h2>
              <button className="modal-close" type="button" onClick={() => setShowAddModal(false)} aria-label="关闭">
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
