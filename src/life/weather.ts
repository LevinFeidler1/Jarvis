import { ToolError } from "../core/types.js";

/**
 * Weather via Open-Meteo — free, no API key, no account (open-meteo.com,
 * non-commercial use). Geocoding via Open-Meteo's geocoding API.
 */

export interface Place {
  name: string;
  lat: number;
  lon: number;
  region?: string;
  country?: string;
}

export interface WeatherNow {
  temperature: number;
  feelsLike: number;
  code: number;
  text: string;
  icon: WeatherIcon;
  windKmh: number;
  precipitationMm: number;
  isDay: boolean;
}

export interface WeatherHour {
  time: string;
  temperature: number;
  precipitationProbability: number;
  code: number;
  icon: WeatherIcon;
}

export interface WeatherDay {
  date: string;
  min: number;
  max: number;
  code: number;
  text: string;
  icon: WeatherIcon;
  precipitationProbability: number;
  sunrise?: string;
  sunset?: string;
}

export interface Weather {
  place: Place;
  now: WeatherNow;
  hours: WeatherHour[];
  days: WeatherDay[];
  /** One-line advice ("Regen ab 14 Uhr — Schirm einpacken."). */
  hint?: string;
  source: "Open-Meteo";
}

export type WeatherIcon = "sun" | "moon" | "partly" | "cloud" | "fog" | "drizzle" | "rain" | "snow" | "storm";

/** WMO weather interpretation codes → German text + icon. */
export function describeWmo(code: number, isDay = true): { text: string; icon: WeatherIcon } {
  if (code === 0) return { text: "Klar", icon: isDay ? "sun" : "moon" };
  if (code === 1) return { text: "Überwiegend klar", icon: isDay ? "sun" : "moon" };
  if (code === 2) return { text: "Teilweise bewölkt", icon: "partly" };
  if (code === 3) return { text: "Bedeckt", icon: "cloud" };
  if (code === 45 || code === 48) return { text: "Nebel", icon: "fog" };
  if (code >= 51 && code <= 57) return { text: "Nieselregen", icon: "drizzle" };
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return { text: code >= 65 && code !== 80 ? "Starker Regen" : "Regen", icon: "rain" };
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return { text: "Schnee", icon: "snow" };
  if (code >= 95) return { text: "Gewitter", icon: "storm" };
  return { text: "Wechselhaft", icon: "partly" };
}

const WET = new Set<WeatherIcon>(["drizzle", "rain", "storm", "snow"]);

/** Plain advice from the next hours (first rain hour, cold, heat). */
export function weatherHint(w: { now: WeatherNow; hours: WeatherHour[] }, now = new Date()): string | undefined {
  const upcoming = w.hours.filter((h) => new Date(h.time).getTime() >= now.getTime() - 30 * 60_000).slice(0, 12);
  const wet = upcoming.find((h) => h.precipitationProbability >= 55 || WET.has(h.icon));
  if (WET.has(w.now.icon)) return `Gerade ${w.now.text.toLowerCase()} — Schirm oder Bahn statt Rad.`;
  if (wet) {
    const hh = new Date(wet.time).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Berlin" });
    return `Regen wahrscheinlich ab ${hh} Uhr — Schirm einpacken.`;
  }
  if (w.now.feelsLike <= 0) return "Frostig — warm anziehen.";
  if (w.now.temperature >= 28) return "Heiß heute — genug trinken.";
  return undefined;
}

interface CacheEntry<T> { at: number; value: T }

export class WeatherService {
  private cache = new Map<string, CacheEntry<Weather>>();
  private geoCache = new Map<string, Place>();

  constructor(private readonly fetchImpl: typeof fetch = fetch, private readonly ttlMs = 15 * 60_000) {}

  private async getJson(url: string): Promise<unknown> {
    const res = await this.fetchImpl(url, { headers: { accept: "application/json", "user-agent": "JARVIS personal assistant" }, signal: AbortSignal.timeout(8_000) });
    if (!res.ok) throw new ToolError(`Wetterdienst nicht erreichbar (HTTP ${res.status}).`, "UPSTREAM_ERROR");
    return res.json();
  }

  /** City / address → coordinates (first match, German names). */
  async geocode(query: string): Promise<Place> {
    const key = query.trim().toLowerCase();
    const hit = this.geoCache.get(key);
    if (hit) return hit;
    const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query.trim().slice(0, 100))}&count=1&language=de&format=json`;
    const data = (await this.getJson(url)) as { results?: Array<{ name: string; latitude: number; longitude: number; admin1?: string; country?: string }> };
    const r = data.results?.[0];
    if (!r) throw new ToolError(`Ort „${query}“ nicht gefunden.`, "NOT_FOUND");
    const place: Place = { name: r.name, lat: r.latitude, lon: r.longitude, region: r.admin1, country: r.country };
    this.geoCache.set(key, place);
    return place;
  }

  async forecast(place: Place, days = 3): Promise<Weather> {
    const d = Math.max(1, Math.min(7, Math.round(days)));
    const key = `${place.lat.toFixed(2)},${place.lon.toFixed(2)},${d}`;
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < this.ttlMs) return hit.value;
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${place.lat}&longitude=${place.lon}` +
      "&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m,precipitation,is_day" +
      "&hourly=temperature_2m,precipitation_probability,weather_code" +
      "&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset" +
      `&timezone=auto&forecast_days=${d}`;
    const raw = (await this.getJson(url)) as OpenMeteoResponse;
    const w = parseForecast(place, raw);
    this.cache.set(key, { at: Date.now(), value: w });
    return w;
  }
}

interface OpenMeteoResponse {
  utc_offset_seconds?: number;
  current?: { temperature_2m: number; apparent_temperature: number; weather_code: number; wind_speed_10m: number; precipitation: number; is_day: number };
  hourly?: { time: string[]; temperature_2m: number[]; precipitation_probability: (number | null)[]; weather_code: number[] };
  daily?: { time: string[]; weather_code: number[]; temperature_2m_max: number[]; temperature_2m_min: number[]; precipitation_probability_max: (number | null)[]; sunrise?: string[]; sunset?: string[] };
}

/** Open-Meteo returns local times without offset; we attach the offset so they are real instants. */
function withOffset(local: string, offsetSec: number): string {
  const sign = offsetSec < 0 ? "-" : "+";
  const abs = Math.abs(offsetSec);
  const hh = String(Math.floor(abs / 3600)).padStart(2, "0");
  const mm = String(Math.floor((abs % 3600) / 60)).padStart(2, "0");
  return `${local.length === 16 ? `${local}:00` : local}${sign}${hh}:${mm}`;
}

export function parseForecast(place: Place, raw: OpenMeteoResponse): Weather {
  if (!raw.current || !raw.hourly || !raw.daily) throw new ToolError("Unerwartete Antwort vom Wetterdienst.", "UPSTREAM_ERROR");
  const off = raw.utc_offset_seconds ?? 0;
  const c = raw.current;
  const now: WeatherNow = {
    temperature: Math.round(c.temperature_2m),
    feelsLike: Math.round(c.apparent_temperature),
    code: c.weather_code,
    ...describeWmo(c.weather_code, c.is_day !== 0),
    windKmh: Math.round(c.wind_speed_10m),
    precipitationMm: c.precipitation,
    isDay: c.is_day !== 0,
  };
  const hours: WeatherHour[] = raw.hourly.time.map((t, i) => ({
    time: withOffset(t, off),
    temperature: Math.round(raw.hourly!.temperature_2m[i] ?? 0),
    precipitationProbability: raw.hourly!.precipitation_probability[i] ?? 0,
    code: raw.hourly!.weather_code[i] ?? 0,
    icon: describeWmo(raw.hourly!.weather_code[i] ?? 0).icon,
  }));
  const days: WeatherDay[] = raw.daily.time.map((date, i) => ({
    date,
    min: Math.round(raw.daily!.temperature_2m_min[i] ?? 0),
    max: Math.round(raw.daily!.temperature_2m_max[i] ?? 0),
    code: raw.daily!.weather_code[i] ?? 0,
    ...describeWmo(raw.daily!.weather_code[i] ?? 0),
    precipitationProbability: raw.daily!.precipitation_probability_max[i] ?? 0,
    sunrise: raw.daily!.sunrise?.[i] ? withOffset(raw.daily!.sunrise[i]!, off) : undefined,
    sunset: raw.daily!.sunset?.[i] ? withOffset(raw.daily!.sunset[i]!, off) : undefined,
  }));
  const w = { place, now, hours, days, source: "Open-Meteo" as const };
  return { ...w, hint: weatherHint(w) };
}
