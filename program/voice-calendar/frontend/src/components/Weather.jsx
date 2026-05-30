import { useState, useEffect } from "react";

const WMO_MAP = {
  0:  { icon: "☀️", label: "晴" },
  1:  { icon: "🌤", label: "多云" },
  2:  { icon: "⛅", label: "局部多云" },
  3:  { icon: "☁️", label: "阴" },
  45: { icon: "🌫", label: "雾" },
  48: { icon: "🌫", label: "冻雾" },
  51: { icon: "🌦", label: "细雨" },
  53: { icon: "🌦", label: "中雨" },
  55: { icon: "🌧", label: "大雨" },
  61: { icon: "🌧", label: "小雨" },
  63: { icon: "🌧", label: "中雨" },
  65: { icon: "🌧", label: "大雨" },
  71: { icon: "🌨", label: "小雪" },
  73: { icon: "🌨", label: "中雪" },
  75: { icon: "❄️", label: "大雪" },
  80: { icon: "🌦", label: "阵雨" },
  81: { icon: "🌧", label: "中阵雨" },
  82: { icon: "⛈", label: "强阵雨" },
  95: { icon: "⛈", label: "雷雨" },
  99: { icon: "⛈", label: "强雷雨" },
};

function getWeatherInfo(code) {
  return WMO_MAP[code] ?? { icon: "🌡", label: "未知" };
}

export function useWeather() {
  const [weather, setWeather] = useState(null);
  const [status, setStatus] = useState("idle");

  useEffect(() => {
    if (!navigator.geolocation) {
      setStatus("error");
      return;
    }
    setStatus("loading");

    navigator.geolocation.getCurrentPosition(
      async ({ coords }) => {
        const { latitude: lat, longitude: lon } = coords;
        try {
          const res = await fetch(
            `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true&temperature_unit=celsius`
          );
          const data = await res.json();
          const cw = data.current_weather;

          let city = "";
          try {
            const geoRes = await fetch(
              `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json`
            );
            const geoData = await geoRes.json();
            city =
              geoData.address?.city ||
              geoData.address?.town ||
              geoData.address?.county ||
              "";
          } catch {}

          const info = getWeatherInfo(cw.weathercode);
          setWeather({ temp: Math.round(cw.temperature), icon: info.icon, label: info.label, city });
          setStatus("ok");
        } catch {
          setStatus("error");
        }
      },
      () => setStatus("error"),
      { timeout: 8000 }
    );
  }, []);

  const icon = status === "ok" && weather ? weather.icon : "☁️";
  const tempText =
    status === "error" || !weather ? "--°C" :
    status === "loading" ? "" :
    `${weather.temp}°C · ${weather.city || weather.label}`;

  return { icon, tempText };
}
