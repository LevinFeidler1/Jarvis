import type { Db } from "../db/database.js";
import { DEFAULT_NEWS_FEEDS, NEWS_FEEDS } from "./news.js";
import type { Place } from "./weather.js";

/** Personal settings for weather, places and news (stored in `settings`). */
export interface LifeSettings {
  /** Home location for weather and "in der Nähe" searches. */
  home: Place | null;
  /** Selected news feed ids (see NEWS_FEEDS). */
  newsFeeds: string[];
}

const KEY = "life";

export async function loadLifeSettings(db: Db): Promise<LifeSettings> {
  const row = await db.one<{ value_json: string }>("SELECT value_json FROM settings WHERE key = $1", [KEY]);
  const stored = row ? (JSON.parse(row.value_json) as Partial<LifeSettings>) : {};
  const feeds = (stored.newsFeeds ?? DEFAULT_NEWS_FEEDS).filter((id) => NEWS_FEEDS.some((f) => f.id === id));
  return { home: stored.home ?? null, newsFeeds: feeds };
}

export async function saveLifeSettings(db: Db, patch: Partial<LifeSettings>): Promise<LifeSettings> {
  const next = { ...(await loadLifeSettings(db)), ...patch };
  await db.run(
    "INSERT INTO settings (key, value_json) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value_json = excluded.value_json",
    [KEY, JSON.stringify(next)],
  );
  return next;
}
