import { useCallback, useRef, useState } from "react";
import { updateSettings } from "../api";

const ADVANCE_OPTIONS = [
  { value: 30, label: "30 秒" },
  { value: 60, label: "1 分钟" },
  { value: 300, label: "5 分钟" },
  { value: 600, label: "10 分钟" },
];

export default function SettingsPanel({ settings, onSettingsChange }) {
  const [saveStatus, setSaveStatus] = useState("idle"); // idle | saving | saved
  const saveTimerRef = useRef(null);
  const debounceTimerRef = useRef(null);

  const handleChange = useCallback(
    (patch) => {
      const next = { ...settings, ...patch };
      onSettingsChange(next);

      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = setTimeout(async () => {
        setSaveStatus("saving");
        try {
          await updateSettings(patch);
          setSaveStatus("saved");
          clearTimeout(saveTimerRef.current);
          saveTimerRef.current = setTimeout(() => setSaveStatus("idle"), 2000);
        } catch {
          setSaveStatus("idle");
        }
      }, 500);
    },
    [settings, onSettingsChange]
  );

  return (
    <div className="settings-panel">
      <div className="settings-save-status">
        {saveStatus === "saving" && <span className="settings-saving">保存中…</span>}
        {saveStatus === "saved" && <span className="settings-saved">✓ 已保存</span>}
      </div>

      {/* 外观 */}
      <section className="settings-section">
        <h3 className="settings-section-title">外观</h3>
        <div className="settings-row">
          <label className="settings-label">主题模式</label>
          <div className="settings-toggle-group">
            <button
              type="button"
              className={`settings-toggle-btn${settings.theme === "light" ? " is-active" : ""}`}
              onClick={() => handleChange({ theme: "light" })}
            >
              ☀️ 白天
            </button>
            <button
              type="button"
              className={`settings-toggle-btn${settings.theme === "dark" ? " is-active" : ""}`}
              onClick={() => handleChange({ theme: "dark" })}
            >
              🌙 夜间
            </button>
          </div>
        </div>
      </section>

      {/* 语音设置 */}
      <section className="settings-section">
        <h3 className="settings-section-title">语音</h3>
        <div className="settings-row">
          <label className="settings-label">识别语言</label>
          <div className="settings-toggle-group">
            <button
              type="button"
              className={`settings-toggle-btn${settings.voice_language === "zh" ? " is-active" : ""}`}
              onClick={() => handleChange({ voice_language: "zh" })}
            >
              中文
            </button>
            <button
              type="button"
              className={`settings-toggle-btn${settings.voice_language === "en" ? " is-active" : ""}`}
              onClick={() => handleChange({ voice_language: "en" })}
            >
              English
            </button>
          </div>
        </div>

        <div className="settings-row">
          <label className="settings-label">朗读语速</label>
          <div className="settings-slider-row">
            <input
              type="range"
              min="0.5"
              max="2"
              step="0.1"
              value={settings.tts_rate}
              onChange={(e) => handleChange({ tts_rate: parseFloat(e.target.value) })}
              className="settings-slider"
            />
            <span className="settings-slider-value">{settings.tts_rate.toFixed(1)}x</span>
          </div>
        </div>

        <div className="settings-row">
          <label className="settings-label">朗读音量</label>
          <div className="settings-slider-row">
            <input
              type="range"
              min="0"
              max="1"
              step="0.1"
              value={settings.tts_volume}
              onChange={(e) => handleChange({ tts_volume: parseFloat(e.target.value) })}
              className="settings-slider"
            />
            <span className="settings-slider-value">{Math.round(settings.tts_volume * 100)}%</span>
          </div>
        </div>

        <div className="settings-row">
          <label className="settings-label">语音提醒</label>
          <button
            type="button"
            className={`settings-switch${settings.voice_reminder_enabled ? " is-on" : ""}`}
            onClick={() => handleChange({ voice_reminder_enabled: !settings.voice_reminder_enabled })}
            aria-pressed={settings.voice_reminder_enabled}
          >
            <span className="settings-switch-thumb" />
          </button>
        </div>
      </section>

      {/* 提醒设置 */}
      <section className="settings-section">
        <h3 className="settings-section-title">提醒</h3>
        <div className="settings-row">
          <label className="settings-label">提前提醒时长</label>
          <select
            value={settings.reminder_advance_seconds}
            onChange={(e) => handleChange({ reminder_advance_seconds: Number(e.target.value) })}
            className="settings-select"
          >
            {ADVANCE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        <div className="settings-row">
          <label className="settings-label">浏览器通知</label>
          <button
            type="button"
            className={`settings-switch${settings.browser_notification_enabled ? " is-on" : ""}`}
            onClick={async () => {
              const next = !settings.browser_notification_enabled;
              if (next && Notification.permission === "default") {
                await Notification.requestPermission();
              }
              handleChange({ browser_notification_enabled: next });
            }}
            aria-pressed={settings.browser_notification_enabled}
          >
            <span className="settings-switch-thumb" />
          </button>
        </div>
      </section>

      {/* 历史记录 */}
      <section className="settings-section">
        <h3 className="settings-section-title">历史记录</h3>
        <div className="settings-row">
          <label className="settings-label">历史语音条数</label>
          <select
            value={settings.voice_history_limit}
            onChange={(e) => handleChange({ voice_history_limit: Number(e.target.value) })}
            className="settings-select"
          >
            {[10, 20, 50, 100].map((n) => (
              <option key={n} value={n}>{n} 条</option>
            ))}
          </select>
        </div>
        <div className="settings-row">
          <label className="settings-label">最近操作条数</label>
          <select
            value={settings.action_history_limit}
            onChange={(e) => handleChange({ action_history_limit: Number(e.target.value) })}
            className="settings-select"
          >
            {[10, 20, 50].map((n) => (
              <option key={n} value={n}>{n} 条</option>
            ))}
          </select>
        </div>
      </section>

      {/* 天气设置 */}
      <section className="settings-section">
        <h3 className="settings-section-title">天气</h3>
        <div className="settings-row">
          <label className="settings-label">温度单位</label>
          <div className="settings-toggle-group">
            <button
              type="button"
              className={`settings-toggle-btn${settings.temperature_unit === "celsius" ? " is-active" : ""}`}
              onClick={() => handleChange({ temperature_unit: "celsius" })}
            >
              °C
            </button>
            <button
              type="button"
              className={`settings-toggle-btn${settings.temperature_unit === "fahrenheit" ? " is-active" : ""}`}
              onClick={() => handleChange({ temperature_unit: "fahrenheit" })}
            >
              °F
            </button>
          </div>
        </div>

        <div className="settings-row">
          <label className="settings-label">城市（留空自动定位）</label>
          <input
            type="text"
            value={settings.city}
            onChange={(e) => handleChange({ city: e.target.value })}
            placeholder="例如：北京"
            className="settings-input"
          />
        </div>
      </section>
    </div>
  );
}
