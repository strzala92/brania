/**
 * Weather – pobieranie danych z darmowego API Open-Meteo (bez klucza API).
 * https://open-meteo.com/
 */
const Weather = (() => {
  const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
  const GEOCODE_URL = 'https://geocoding-api.open-meteo.com/v1/search';
  const REVERSE_URL = 'https://nominatim.openstreetmap.org/reverse';

  const HOURLY = [
    'temperature_2m',
    'relative_humidity_2m',
    'pressure_msl',
    'cloud_cover',
    'wind_speed_10m',
    'wind_gusts_10m',
    'wind_direction_10m',
    'precipitation',
    'precipitation_probability',
    'weather_code',
    'is_day',
  ];

  /**
   * Pobiera prognozę godzinową + 7 dni wstecz (potrzebne do trendu ciśnienia
   * i oszacowania temperatury wody).
   */
  async function fetchForecast(lat, lon, forecastDays = 7) {
    const params = new URLSearchParams({
      latitude: lat.toFixed(4),
      longitude: lon.toFixed(4),
      hourly: HOURLY.join(','),
      daily: 'sunrise,sunset',
      past_days: '7',
      forecast_days: String(forecastDays),
      timezone: 'auto',
      wind_speed_unit: 'ms',
    });
    const res = await fetch(`${FORECAST_URL}?${params}`);
    if (!res.ok) throw new Error(`Open-Meteo: HTTP ${res.status}`);
    const json = await res.json();
    if (json.error) throw new Error(json.reason || 'Błąd Open-Meteo');
    return normalize(json);
  }

  /** "2026-10-06T13:00" (czas lokalny miejsca) -> znacznik UTC w ms */
  function localToUtc(str, offsetSec) {
    const [d, t = '00:00'] = str.split('T');
    const [y, m, day] = d.split('-').map(Number);
    const [hh, mm] = t.split(':').map(Number);
    return Date.UTC(y, m - 1, day, hh, mm) - offsetSec * 1000;
  }

  function normalize(json) {
    const off = json.utc_offset_seconds || 0;
    const h = json.hourly;
    const hours = h.time.map((time, i) => ({
      local: time,
      ts: localToUtc(time, off),
      temp: h.temperature_2m[i],
      humidity: h.relative_humidity_2m[i],
      pressure: h.pressure_msl[i],
      cloud: h.cloud_cover[i],
      wind: h.wind_speed_10m[i],
      gust: h.wind_gusts_10m[i],
      windDir: h.wind_direction_10m[i],
      precip: h.precipitation[i],
      precipProb: h.precipitation_probability[i],
      code: h.weather_code[i],
      isDay: h.is_day[i] === 1,
    }));
    const days = json.daily.time.map((date, i) => ({
      date,
      sunrise: localToUtc(json.daily.sunrise[i], off),
      sunset: localToUtc(json.daily.sunset[i], off),
    }));
    return {
      lat: json.latitude,
      lon: json.longitude,
      timezone: json.timezone,
      utcOffset: off,
      hours,
      days,
    };
  }

  async function searchCity(query) {
    const params = new URLSearchParams({ name: query, count: '8', language: 'pl', format: 'json' });
    const res = await fetch(`${GEOCODE_URL}?${params}`);
    if (!res.ok) throw new Error(`Geokodowanie: HTTP ${res.status}`);
    const json = await res.json();
    return (json.results || []).map((r) => ({
      name: r.name,
      admin: [r.admin1, r.country].filter(Boolean).join(', '),
      lat: r.latitude,
      lon: r.longitude,
    }));
  }

  async function reverseName(lat, lon) {
    try {
      const params = new URLSearchParams({ lat, lon, format: 'json', zoom: '10', 'accept-language': 'pl' });
      const res = await fetch(`${REVERSE_URL}?${params}`);
      if (!res.ok) return null;
      const j = await res.json();
      const a = j.address || {};
      return a.city || a.town || a.village || a.municipality || a.county || j.name || null;
    } catch {
      return null;
    }
  }

  const CODES = {
    0: ['Bezchmurnie', '☀️'], 1: ['Przeważnie pogodnie', '🌤️'], 2: ['Częściowe zachmurzenie', '⛅'],
    3: ['Pochmurno', '☁️'], 45: ['Mgła', '🌫️'], 48: ['Mgła szronowa', '🌫️'],
    51: ['Lekka mżawka', '🌦️'], 53: ['Mżawka', '🌦️'], 55: ['Gęsta mżawka', '🌧️'],
    56: ['Marznąca mżawka', '🌧️'], 57: ['Marznąca mżawka', '🌧️'],
    61: ['Słaby deszcz', '🌦️'], 63: ['Deszcz', '🌧️'], 65: ['Ulewa', '🌧️'],
    66: ['Marznący deszcz', '🌧️'], 67: ['Marznący deszcz', '🌧️'],
    71: ['Słaby śnieg', '🌨️'], 73: ['Śnieg', '🌨️'], 75: ['Intensywny śnieg', '❄️'], 77: ['Ziarna śniegu', '🌨️'],
    80: ['Przelotny deszcz', '🌦️'], 81: ['Przelotne opady', '🌧️'], 82: ['Gwałtowne opady', '⛈️'],
    85: ['Przelotny śnieg', '🌨️'], 86: ['Intensywny śnieg', '❄️'],
    95: ['Burza', '⛈️'], 96: ['Burza z gradem', '⛈️'], 99: ['Silna burza z gradem', '⛈️'],
  };
  const describeCode = (c) => CODES[c] || ['—', '🌡️'];

  return { fetchForecast, searchCity, reverseName, describeCode };
})();

if (typeof module !== 'undefined') module.exports = Weather;
