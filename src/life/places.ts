import { ToolError } from "../core/types.js";
import type { Place } from "./weather.js";

/**
 * Finds restaurants, cafés, hairdressers, doctors … near a place using
 * OpenStreetMap (Overpass API) — free, no key. Results are third-party data.
 */

export const PLACE_KINDS = {
  restaurant: ['["amenity"="restaurant"]'],
  cafe: ['["amenity"="cafe"]'],
  bar: ['["amenity"~"^(bar|pub|biergarten)$"]'],
  fast_food: ['["amenity"="fast_food"]'],
  hairdresser: ['["shop"="hairdresser"]', '["shop"="beauty"]'],
  doctor: ['["amenity"="doctors"]', '["healthcare"="doctor"]'],
  dentist: ['["amenity"="dentist"]'],
  pharmacy: ['["amenity"="pharmacy"]'],
  gym: ['["leisure"="fitness_centre"]'],
  supermarket: ['["shop"="supermarket"]'],
  hotel: ['["tourism"="hotel"]'],
  cinema: ['["amenity"="cinema"]'],
} as const;
export type PlaceKind = keyof typeof PLACE_KINDS;

const CUISINE: Record<string, string> = {
  italienisch: "italian", italian: "italian", pizza: "pizza", pasta: "italian", japanisch: "japanese", sushi: "sushi", ramen: "ramen",
  indisch: "indian", chinesisch: "chinese", thai: "thai", thailändisch: "thai", vietnamesisch: "vietnamese", griechisch: "greek",
  türkisch: "turkish", döner: "kebab", kebab: "kebab", mexikanisch: "mexican", spanisch: "spanish", tapas: "tapas", französisch: "french",
  deutsch: "german", burger: "burger", steak: "steak_house", fisch: "seafood", seafood: "seafood", koreanisch: "korean",
  libanesisch: "lebanese", orientalisch: "middle_eastern", portugiesisch: "portuguese", asiatisch: "asian", vegetarisch: "vegetarian",
  vegan: "vegan", brunch: "breakfast", frühstück: "breakfast", kaffee: "coffee_shop", eis: "ice_cream",
};

export interface FoundPlace {
  name: string;
  kind: string;
  cuisine?: string;
  address?: string;
  phone?: string;
  website?: string;
  openingHours?: string;
  /** OSM reservation tag: yes | no | required | recommended. */
  reservation?: string;
  distanceM: number;
  lat: number;
  lon: number;
  mapsUrl: string;
}

const ENDPOINTS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"];

function haversine(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const R = 6_371_000, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(x)));
}

const clean = (v: unknown, max = 160) => (typeof v === "string" && v.trim() ? v.replace(/[\r\n]+/g, " ").trim().slice(0, max) : undefined);

/** Builds the Overpass QL query (exported for tests). */
export function buildOverpassQuery(kind: PlaceKind, center: { lat: number; lon: number }, radiusM: number, opts: { cuisine?: string; name?: string } = {}): string {
  const filters: string[] = [];
  const c = opts.cuisine ? CUISINE[opts.cuisine.toLowerCase()] ?? opts.cuisine.toLowerCase().replace(/[^a-z_]/g, "") : undefined;
  if (c === "vegan" || c === "vegetarian") filters.push(`["diet:${c}"~"^(yes|only)$"]`);
  else if (c) filters.push(`["cuisine"~"${c}",i]`);
  if (opts.name) filters.push(`["name"~"${opts.name.replace(/["\\\]\[(){}.*+?^$|]/g, "").slice(0, 60)}",i]`);
  const r = Math.max(200, Math.min(10_000, Math.round(radiusM)));
  const around = `(around:${r},${center.lat.toFixed(5)},${center.lon.toFixed(5)})`;
  const parts = PLACE_KINDS[kind].flatMap((t) => [`node${t}${filters.join("")}${around};`, `way${t}${filters.join("")}${around};`]);
  return `[out:json][timeout:15];(${parts.join("")});out center tags 80;`;
}

interface OverpassElement { lat?: number; lon?: number; center?: { lat: number; lon: number }; tags?: Record<string, string> }

export function parseOverpass(data: { elements?: OverpassElement[] }, kind: PlaceKind, center: { lat: number; lon: number }, max = 8): FoundPlace[] {
  const seen = new Set<string>();
  const out: FoundPlace[] = [];
  for (const el of data.elements ?? []) {
    const t = el.tags ?? {};
    const name = clean(t.name, 100);
    const lat = el.lat ?? el.center?.lat, lon = el.lon ?? el.center?.lon;
    if (!name || lat === undefined || lon === undefined) continue;
    const key = `${name.toLowerCase()}|${lat.toFixed(3)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const street = [t["addr:street"], t["addr:housenumber"]].filter(Boolean).join(" ");
    const city = [t["addr:postcode"], t["addr:city"]].filter(Boolean).join(" ");
    const website = clean(t.website ?? t["contact:website"] ?? t.url, 300);
    out.push({
      name,
      kind,
      cuisine: clean(t.cuisine?.replace(/_/g, " ").replace(/;/g, ", "), 80),
      address: clean([street, city].filter(Boolean).join(", "), 160),
      phone: clean(t.phone ?? t["contact:phone"], 40),
      website: website && /^https?:\/\//i.test(website) ? website : website ? `https://${website.replace(/^\/+/, "")}` : undefined,
      openingHours: clean(t.opening_hours, 120),
      reservation: clean(t.reservation, 20),
      distanceM: haversine(center, { lat, lon }),
      lat,
      lon,
      mapsUrl: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${name} ${street} ${t["addr:city"] ?? ""}`.trim())}`,
    });
  }
  return out.sort((a, b) => a.distanceM - b.distanceM).slice(0, max);
}

export class PlacesService {
  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  async search(kind: PlaceKind, center: Place, opts: { cuisine?: string; name?: string; radiusM?: number; max?: number } = {}): Promise<FoundPlace[]> {
    const query = buildOverpassQuery(kind, center, opts.radiusM ?? 1500, opts);
    let lastErr: unknown;
    for (const url of ENDPOINTS) {
      try {
        const res = await this.fetchImpl(url, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded", "user-agent": "JARVIS personal assistant" },
          body: `data=${encodeURIComponent(query)}`,
          signal: AbortSignal.timeout(15_000),
        });
        if (!res.ok) throw new ToolError(`Ortssuche nicht erreichbar (HTTP ${res.status}).`, "UPSTREAM_ERROR");
        return parseOverpass((await res.json()) as { elements?: OverpassElement[] }, kind, center, opts.max ?? 8);
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr instanceof ToolError ? lastErr : new ToolError("Ortssuche gerade nicht erreichbar (OpenStreetMap).", "UPSTREAM_ERROR");
  }
}
