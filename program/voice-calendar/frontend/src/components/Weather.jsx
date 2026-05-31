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

async function fetchWeatherByCoords(lat, lon) {
  const res = await fetch(
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true&temperature_unit=celsius`
  );
  const data = await res.json();
  return data.current_weather;
}

async function geocodeCity(cityName) {
  const res = await fetch(
    `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(cityName)}&format=json&limit=1`
  );
  const data = await res.json();
  if (!data.length) return null;
  return { lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon), city: cityName };
}

async function reverseGeocode(lat, lon) {
  const res = await fetch(
    `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json`
  );
  const data = await res.json();
  return (
    data.address?.city ||
    data.address?.town ||
    data.address?.county ||
    ""
  );
}

export function useWeather({ temperatureUnit = "celsius", city = "" } = {}) {
  const [weather, setWeather] = useState(null);
  const [status, setStatus] = useState("idle");

  useEffect(() => {
    setStatus("loading");

    async function load() {
      try {
        let lat, lon, resolvedCity;

        if (city.trim()) {
          const geo = await geocodeCity(city.trim());
          if (!geo) { setStatus("error"); return; }
          lat = geo.lat;
          lon = geo.lon;
          resolvedCity = geo.city;
        } else {
          if (!navigator.geolocation) { setStatus("error"); return; }
          const pos = await new Promise((resolve, reject) =>
            navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 8000 })
          );
          lat = pos.coords.latitude;
          lon = pos.coords.longitude;
          resolvedCity = await reverseGeocode(lat, lon).catch(() => "");
        }

        const cw = await fetchWeatherByCoords(lat, lon);
        const info = getWeatherInfo(cw.weathercode);
        setWeather({ tempC: Math.round(cw.temperature), icon: info.icon, label: info.label, city: resolvedCity });
        setStatus("ok");
      } catch {
        setStatus("error");
      }
    }

    load();
  }, [city]);

  const icon = status === "ok" && weather ? weather.icon : "☁️";

  let tempDisplay = "--";
  if (status === "ok" && weather) {
    if (temperatureUnit === "fahrenheit") {
      tempDisplay = `${Math.round(weather.tempC * 9 / 5 + 32)}°F`;
    } else {
      tempDisplay = `${weather.tempC}°C`;
    }
  }

  const tempText =
    status === "error" || !weather ? "--°C" :
    status === "loading" ? "" :
    `${tempDisplay} · ${weather.city || weather.label}`;

  return { icon, tempText };
}
