// RedSecTools — Weather widget for homepage

const WEATHER_CODES = {
  0: { label: "Clear", icon: "☀️" },
  1: { label: "Mainly clear", icon: "🌤️" },
  2: { label: "Partly cloudy", icon: "⛅" },
  3: { label: "Overcast", icon: "☁️" },
  45: { label: "Fog", icon: "🌫️" },
  48: { label: "Rime fog", icon: "🌫️" },
  51: { label: "Light drizzle", icon: "🌦️" },
  53: { label: "Drizzle", icon: "🌦️" },
  55: { label: "Heavy drizzle", icon: "🌧️" },
  61: { label: "Light rain", icon: "🌧️" },
  63: { label: "Rain", icon: "🌧️" },
  65: { label: "Heavy rain", icon: "🌧️" },
  71: { label: "Light snow", icon: "🌨️" },
  73: { label: "Snow", icon: "❄️" },
  75: { label: "Heavy snow", icon: "❄️" },
  77: { label: "Snow grains", icon: "❄️" },
  80: { label: "Light showers", icon: "🌦️" },
  81: { label: "Showers", icon: "🌧️" },
  82: { label: "Heavy showers", icon: "🌧️" },
  85: { label: "Snow showers", icon: "🌨️" },
  86: { label: "Heavy snow showers", icon: "🌨️" },
  95: { label: "Thunderstorm", icon: "⛈️" },
  96: { label: "Thunderstorm + hail", icon: "⛈️" },
  99: { label: "Thunderstorm + heavy hail", icon: "⛈️" },
};

function getWeatherInfo(code) {
  return WEATHER_CODES[code] || { label: "Unknown", icon: "🌡️" };
}

let weatherTimezones = [];

function updateWeatherTimes() {
  weatherTimezones.forEach(({ tz, elId }) => {
    const el = document.getElementById(elId);
    if (!el) return;
    try {
      const now = new Date();
      el.textContent = now.toLocaleTimeString("en-US", {
        timeZone: tz,
        hour: "2-digit",
        minute: "2-digit",
        hour12: true,
      });
    } catch {}
  });
}

import { escapeHtml } from "./ui-components.js";

export async function loadWeather() {
  const container = document.getElementById("weather-widget");
  if (!container) return;

  try {
    const res = await fetch("/api/homepage/weather");
    if (!res.ok) {
      container.innerHTML = "";
      return;
    }
    const data = await res.json();

    if (!data.locations || data.locations.length === 0) {
      container.innerHTML = '<span class="text-xs text-muted">No weather locations configured</span>';
      return;
    }

    weatherTimezones = [];
    container.innerHTML = data.locations.map((loc, i) => {
      if (loc.error) {
        return '<div class="weather-card"><span class="text-xs text-muted">' + escapeHtml(loc.name) + '</span><span class="text-xs text-muted">—</span></div>';
      }
      const info = getWeatherInfo(loc.code);
      const tz = loc.timezone || "UTC";
      const timeId = "weather-time-" + i;
      weatherTimezones.push({ tz, elId: timeId });
      return '<div class="weather-card" title="' + info.label + '">' +
        '<div class="weather-icon-temp">' +
          '<span class="weather-icon">' + info.icon + '</span>' +
          '<span class="weather-temp">' + loc.temp + '°</span>' +
        '</div>' +
        '<span class="weather-name">' + escapeHtml(loc.name) + '</span>' +
        '<span class="weather-time" id="' + timeId + '"></span>' +
      '</div>';
    }).join("");

    updateWeatherTimes();
    setInterval(updateWeatherTimes, 1000);
  } catch {
    container.innerHTML = "";
  }
}
