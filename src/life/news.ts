import { ToolError } from "../core/types.js";

/**
 * News headlines from free RSS/Atom feeds (no API key, no account). Headlines
 * are third-party content: tools return them as external_data.
 */

export interface NewsFeed {
  id: string;
  name: string;
  topic: string;
  url: string;
}

export const NEWS_FEEDS: NewsFeed[] = [
  { id: "tagesschau", name: "tagesschau", topic: "Nachrichten", url: "https://www.tagesschau.de/xml/rss2/" },
  { id: "ndr-hamburg", name: "NDR Hamburg", topic: "Hamburg", url: "https://www.ndr.de/nachrichten/hamburg/index-rss.xml" },
  { id: "spiegel", name: "SPIEGEL", topic: "Nachrichten", url: "https://www.spiegel.de/schlagzeilen/index.rss" },
  { id: "tagesschau-wirtschaft", name: "tagesschau Wirtschaft", topic: "Wirtschaft", url: "https://www.tagesschau.de/wirtschaft/index~rss2.xml" },
  { id: "heise", name: "heise online", topic: "Technik", url: "https://www.heise.de/rss/heise-atom.xml" },
  { id: "t3n", name: "t3n", topic: "Digital & Startups", url: "https://t3n.de/rss.xml" },
  { id: "golem", name: "Golem", topic: "Technik", url: "https://rss.golem.de/rss.php?feed=RSS2.0" },
  { id: "kicker", name: "kicker", topic: "Sport", url: "https://newsfeed.kicker.de/news/aktuell" },
];
export const DEFAULT_NEWS_FEEDS = ["tagesschau", "ndr-hamburg", "heise"];

export interface NewsItem {
  title: string;
  link: string;
  source: string;
  topic: string;
  published?: string;
  summary?: string;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", auml: "ä", ouml: "ö", uuml: "ü", Auml: "Ä", Ouml: "Ö", Uuml: "Ü", szlig: "ß", euro: "€", ndash: "–", mdash: "—", hellip: "…", bdquo: "„", ldquo: "“", rdquo: "”" };

function decode(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => safeChar(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => safeChar(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n] ?? m)
    // Many feeds escape their HTML (&lt;p&gt;) — strip the tags that appear after decoding too.
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
const safeChar = (n: number) => (n > 0 && n < 0x110000 ? String.fromCodePoint(n) : "");

const tag = (block: string, name: string) => block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i"))?.[1];

/** Minimal RSS 2.0 / Atom parser — titles, links, dates, short summary. */
export function parseFeed(xml: string, feed: Pick<NewsFeed, "name" | "topic">, max = 10): NewsItem[] {
  const blocks = [...xml.matchAll(/<(item|entry)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/gi)].map((m) => m[2]!).slice(0, max);
  const items: NewsItem[] = [];
  for (const b of blocks) {
    const title = decode(tag(b, "title") ?? "").slice(0, 200);
    let link = decode(tag(b, "link") ?? "");
    if (!link) link = b.match(/<link[^>]*?href="([^"]+)"/i)?.[1] ?? "";
    link = link.replace(/&amp;/g, "&").trim();
    if (!title || !/^https?:\/\//i.test(link)) continue;
    const date = decode(tag(b, "pubDate") ?? tag(b, "published") ?? tag(b, "updated") ?? tag(b, "dc:date") ?? "");
    const parsed = date ? new Date(date) : undefined;
    const summary = decode(tag(b, "description") ?? tag(b, "summary") ?? "").slice(0, 280);
    items.push({ title, link, source: feed.name, topic: feed.topic, published: parsed && !Number.isNaN(parsed.getTime()) ? parsed.toISOString() : undefined, summary: summary || undefined });
  }
  return items;
}

export class NewsService {
  private cache = new Map<string, { at: number; items: NewsItem[] }>();

  constructor(private readonly fetchImpl: typeof fetch = fetch, private readonly ttlMs = 15 * 60_000) {}

  private async fetchFeed(feed: NewsFeed): Promise<NewsItem[]> {
    const hit = this.cache.get(feed.id);
    if (hit && Date.now() - hit.at < this.ttlMs) return hit.items;
    const res = await this.fetchImpl(feed.url, { headers: { accept: "application/rss+xml, application/atom+xml, application/xml, text/xml", "user-agent": "JARVIS personal assistant" }, signal: AbortSignal.timeout(6_000) });
    if (!res.ok) throw new ToolError(`${feed.name}: HTTP ${res.status}`, "UPSTREAM_ERROR");
    const text = (await res.text()).slice(0, 2_000_000);
    const items = parseFeed(text, feed, 15);
    this.cache.set(feed.id, { at: Date.now(), items });
    return items;
  }

  /**
   * Newest headlines across the chosen feeds; a failing feed is skipped
   * (reported in `failed`), never fatal.
   */
  async headlines(feedIds: string[], opts: { topic?: string; query?: string; max?: number } = {}): Promise<{ items: NewsItem[]; failed: string[] }> {
    let feeds = NEWS_FEEDS.filter((f) => feedIds.includes(f.id));
    if (opts.topic) {
      const t = opts.topic.toLowerCase();
      const byTopic = NEWS_FEEDS.filter((f) => f.topic.toLowerCase().includes(t) || f.name.toLowerCase().includes(t));
      if (byTopic.length) feeds = byTopic;
    }
    if (!feeds.length) feeds = NEWS_FEEDS.filter((f) => DEFAULT_NEWS_FEEDS.includes(f.id));
    const failed: string[] = [];
    const results = await Promise.all(feeds.map((f) => this.fetchFeed(f).catch(() => (failed.push(f.name), [] as NewsItem[]))));
    // Interleave so every source gets a say, newest first within a source.
    const max = Math.max(1, Math.min(20, opts.max ?? 6));
    const q = opts.query?.toLowerCase();
    const lists = results.map((r) => (q ? r.filter((i) => `${i.title} ${i.summary ?? ""}`.toLowerCase().includes(q)) : r));
    const items: NewsItem[] = [];
    for (let i = 0; items.length < max && lists.some((l) => l[i]); i++) for (const l of lists) if (l[i] && items.length < max) items.push(l[i]!);
    return { items, failed };
  }
}
