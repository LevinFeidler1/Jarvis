import { lookup } from "node:dns/promises";
import net from "node:net";
import type { Browser, BrowserContext, Page } from "playwright-core";
import {
  type BrowserAction,
  type BrowserEngine,
  type BrowserRunRequest,
  type BrowserRunResult,
  type BrowserStep,
  type PageElement,
  type PageState,
  fingerprintOf,
} from "./types.js";

// ─── SSRF protection: the browser may only reach the public internet ─────────

function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number) as [number, number];
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v6 = ip.toLowerCase();
  if (v6.startsWith("::ffff:")) return isPrivateIp(v6.slice(7));
  return v6 === "::1" || v6 === "::" || v6.startsWith("fc") || v6.startsWith("fd") || v6.startsWith("fe80");
}

export class BlockedUrlError extends Error {}

const dnsCache = new Map<string, Promise<boolean>>();

/** Throws for non-http(s) URLs and hosts that resolve to private/internal addresses. */
export async function assertPublicUrl(raw: string, allowPrivate = false): Promise<URL> {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new BlockedUrlError(`Ungültige Adresse: ${raw}`);
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new BlockedUrlError(`Nur http(s)-Adressen erlaubt (${u.protocol}).`);
  if (allowPrivate) return u;
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (/^(localhost|.*\.local|.*\.internal|metadata\.google\.internal)$/i.test(host)) throw new BlockedUrlError(`Interne Adresse blockiert: ${host}`);
  let check = dnsCache.get(host);
  if (!check) {
    check = net.isIP(host)
      ? Promise.resolve(isPrivateIp(host))
      : lookup(host, { all: true }).then((addrs) => addrs.some((a) => isPrivateIp(a.address)), () => false);
    dnsCache.set(host, check);
    if (dnsCache.size > 500) dnsCache.clear();
  }
  if (await check) throw new BlockedUrlError(`Interne Adresse blockiert: ${host}`);
  return u;
}

// ─── Page snapshot (runs inside the page) ────────────────────────────────────

const SNAPSHOT = `(() => {
  const sel = 'a[href], button, input:not([type=hidden]), select, textarea, summary, [role=button], [role=link], [role=checkbox], [role=tab], [role=menuitem], [onclick]';
  const visible = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
  const clean = (t) => (t || '').replace(/\\s+/g, ' ').trim();
  document.querySelectorAll('[data-jarvis-ref]').forEach((el) => el.removeAttribute('data-jarvis-ref'));
  const els = [...document.querySelectorAll(sel)].filter(visible).slice(0, 150);
  const out = els.map((el, i) => {
    const ref = 'e' + (i + 1);
    el.setAttribute('data-jarvis-ref', ref);
    const form = el.form || el.closest('form');
    const inputs = form ? [...form.querySelectorAll('input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=checkbox]):not([type=radio]), textarea, select')] : [];
    const formText = form ? ((form.getAttribute('action') || '') + ' ' + form.id + ' ' + form.className + ' ' + (form.getAttribute('role') || '')) : '';
    return {
      ref, tag: el.tagName.toLowerCase(), type: el.getAttribute('type'), role: el.getAttribute('role'),
      text: clean(el.getAttribute('aria-label') || (el.tagName === 'INPUT' && ['submit','button'].includes(el.type) ? el.value : '') || el.innerText || el.getAttribute('placeholder') || el.getAttribute('title') || el.getAttribute('alt') || el.value).slice(0, 80),
      name: el.getAttribute('name') || el.id || null,
      href: el.tagName === 'A' ? el.href : null,
      autocomplete: el.getAttribute('autocomplete'),
      inForm: !!form,
      formIsSearch: !!form && (/search|such/i.test(formText) || !!form.querySelector('input[type=search]') || (inputs.length === 1 && !form.querySelector('input[type=password]'))),
      formHasPassword: !!form && !!form.querySelector('input[type=password]'),
      formHasPayment: !!form && !!form.querySelector('[autocomplete^=cc-], [name*=card i], [name*=iban i], [name*=cvc i], [name*=cvv i], [name*=kreditkarte i]'),
    };
  });
  const text = (document.body ? document.body.innerText : '').replace(/[ \\t]+/g, ' ').replace(/\\n\\s*\\n+/g, '\\n').trim().slice(0, 20000);
  return { url: location.href, title: document.title, text, elements: out };
})()`;

async function snapshot(page: Page): Promise<PageState> {
  return (await page.evaluate(SNAPSHOT)) as PageState;
}

async function settle(page: Page): Promise<void> {
  await page.waitForLoadState("domcontentloaded", { timeout: 8000 }).catch(() => undefined);
  await page.waitForLoadState("networkidle", { timeout: 3000 }).catch(() => undefined);
}

/** Finds the element for a ref; if the page changed, falls back to the recorded fingerprint. */
async function locate(page: Page, ref: string, fingerprint?: string): Promise<{ el: PageElement; selector: string }> {
  const state = await snapshot(page);
  let el = state.elements.find((e) => e.ref === ref);
  if (fingerprint && (!el || fingerprintOf(el) !== fingerprint)) el = state.elements.find((e) => fingerprintOf(e) === fingerprint);
  if (!el) throw new Error(`Element ${ref} wurde auf der Seite nicht (mehr) gefunden.`);
  return { el, selector: `[data-jarvis-ref="${el.ref}"]` };
}

// ─── Engine ──────────────────────────────────────────────────────────────────

export interface PlaywrightEngineOptions {
  /** Chromium binary (local / worker). */
  executablePath?: string;
  /**
   * Injected launcher (api/browser.ts passes playwright-core + @sparticuz/chromium).
   * Keeping these imports out of this module keeps the main Vercel function small.
   */
  launch?: () => Promise<Browser>;
  /** Tests only: allow 127.0.0.1 test servers. */
  allowPrivateHosts?: boolean;
  maxDownloadBytes?: number;
  /** Hard limit per request. */
  timeoutMs?: number;
}

interface Session {
  context: BrowserContext;
  page: Page;
  stepsKey: string;
  lastUsed: number;
}

const SESSION_TTL_MS = 5 * 60_000;
const MAX_SESSIONS = 3;

/**
 * Headless Chromium via playwright-core. One isolated context per task (no
 * cookies or storage survive the task, no access to local files), public
 * internet only. Warm sessions are reused; otherwise the recorded steps are
 * replayed.
 */
export class PlaywrightEngine implements BrowserEngine {
  readonly kind = "local" as const;
  private browser?: Promise<Browser>;
  private sessions = new Map<string, Session>();

  constructor(private readonly opts: PlaywrightEngineOptions = {}) {}

  private async getBrowser(): Promise<Browser> {
    const existing = this.browser && (await this.browser.catch(() => undefined));
    if (existing?.isConnected()) return existing;
    this.browser = (async () => {
      if (this.opts.launch) return this.opts.launch();
      if (!this.opts.executablePath) throw new Error("Kein Chromium gefunden (JARVIS_CHROMIUM_PATH setzen).");
      // Computed specifier: the bundler must not trace playwright into the main function.
      const pkg = ["playwright", "core"].join("-");
      const { chromium } = (await import(/* @vite-ignore */ pkg)) as typeof import("playwright-core");
      return chromium.launch({ executablePath: this.opts.executablePath, headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
    })();
    return this.browser;
  }

  private async newSession(taskId: string): Promise<Session> {
    const browser = await this.getBrowser();
    const context = await browser.newContext({
      viewport: { width: 1280, height: 860 },
      locale: "de-DE",
      timezoneId: "Europe/Berlin",
      acceptDownloads: true,
      serviceWorkers: "block",
      permissions: [],
    });
    context.setDefaultTimeout(10_000);
    context.setDefaultNavigationTimeout(20_000);
    await context.route("**/*", async (route) => {
      const url = route.request().url();
      if (url.startsWith("data:") || url.startsWith("blob:")) return route.continue();
      try {
        await assertPublicUrl(url, this.opts.allowPrivateHosts);
        return route.continue();
      } catch {
        return route.abort("blockedbyclient");
      }
    });
    const page = await context.newPage();
    const s: Session = { context, page, stepsKey: "[]", lastUsed: Date.now() };
    this.sessions.set(taskId, s);
    return s;
  }

  private async sweep(): Promise<void> {
    const now = Date.now();
    const entries = [...this.sessions.entries()].sort((a, b) => b[1].lastUsed - a[1].lastUsed);
    for (const [i, [id, s]] of entries.entries()) {
      if (now - s.lastUsed > SESSION_TTL_MS || i >= MAX_SESSIONS) {
        this.sessions.delete(id);
        await s.context.close().catch(() => undefined);
      }
    }
  }

  private async apply(page: Page, step: BrowserStep): Promise<string | undefined> {
    if (step.type === "goto") {
      await assertPublicUrl(step.url, this.opts.allowPrivateHosts);
      await page.goto(step.url, { waitUntil: "domcontentloaded" });
      await settle(page);
      return undefined;
    }
    const { el, selector } = await locate(page, step.ref, step.fingerprint || undefined);
    if (step.type === "click") {
      await page.click(selector, { timeout: 8000 });
    } else {
      await page.fill(selector, step.text, { timeout: 8000 });
      if (step.submit) await page.press(selector, "Enter");
    }
    await settle(page);
    return fingerprintOf(el);
  }

  async run(req: BrowserRunRequest): Promise<BrowserRunResult> {
    const timeout = this.opts.timeoutMs ?? 45_000;
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        this.runInner(req),
        new Promise<BrowserRunResult>((resolve) => {
          timer = setTimeout(() => resolve({ ok: false, error: `Zeitlimit von ${Math.round(timeout / 1000)} s überschritten.` }), timeout);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  private async runInner(req: BrowserRunRequest): Promise<BrowserRunResult> {
    await this.sweep();
    const key = JSON.stringify(req.steps);
    let s = this.sessions.get(req.taskId);
    try {
      if (!s || s.stepsKey !== key || s.page.isClosed()) {
        if (s) await s.context.close().catch(() => undefined);
        s = await this.newSession(req.taskId);
        for (const step of req.steps) await this.apply(s.page, step);
        s.stepsKey = key;
      }
      s.lastUsed = Date.now();
      const page = s.page;
      const a: BrowserAction = req.action;
      let fingerprint: string | undefined;
      let screenshot: string | undefined;
      let download: BrowserRunResult["download"];
      if (a.type === "goto" || a.type === "click" || a.type === "type") {
        fingerprint = await this.apply(page, a);
        s.stepsKey = JSON.stringify([...req.steps, fingerprint ? { ...a, fingerprint } : a]);
      } else if (a.type === "screenshot") {
        screenshot = (await page.screenshot({ type: "jpeg", quality: 70 })).toString("base64");
      } else if (a.type === "download") {
        download = await this.download(s, a);
      }
      return { ok: true, state: await snapshot(page), screenshot, download, fingerprint };
    } catch (err) {
      if (s) {
        this.sessions.delete(req.taskId);
        await s.context.close().catch(() => undefined);
      }
      const msg = err instanceof Error ? err.message.split("\n")[0]! : String(err);
      return { ok: false, error: msg.replace(/^page\.\w+: /, "") };
    }
  }

  private async download(s: Session, a: Extract<BrowserAction, { type: "download" }>): Promise<NonNullable<BrowserRunResult["download"]>> {
    const max = this.opts.maxDownloadBytes ?? 3 * 1024 * 1024;
    if (a.url) {
      // Follow redirects manually so every hop passes the SSRF check.
      let url = (await assertPublicUrl(new URL(a.url, s.page.url()).href, this.opts.allowPrivateHosts)).href;
      for (let hop = 0; hop < 5; hop++) {
        const res = await s.context.request.get(url, { maxRedirects: 0, timeout: 20_000 });
        if (res.status() >= 300 && res.status() < 400 && res.headers().location) {
          url = (await assertPublicUrl(new URL(res.headers().location!, url).href, this.opts.allowPrivateHosts)).href;
          continue;
        }
        if (!res.ok()) throw new Error(`Download fehlgeschlagen (HTTP ${res.status()}).`);
        const body = await res.body();
        if (body.length > max) throw new Error(`Datei größer als ${Math.round(max / 1048576)} MB.`);
        const cd = res.headers()["content-disposition"] ?? "";
        const name = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(cd)?.[1] ?? (new URL(url).pathname.split("/").pop() || "download");
        return { name: decodeURIComponent(name), mime: res.headers()["content-type"] ?? "application/octet-stream", base64: body.toString("base64") };
      }
      throw new Error("Zu viele Weiterleitungen.");
    }
    if (!a.ref) throw new Error("url oder ref angeben.");
    const { selector } = await locate(s.page, a.ref, a.fingerprint);
    const [dl] = await Promise.all([s.page.waitForEvent("download", { timeout: 15_000 }), s.page.click(selector)]);
    const stream = await dl.createReadStream();
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const c of stream) {
      size += (c as Buffer).length;
      if (size > max) throw new Error(`Datei größer als ${Math.round(max / 1048576)} MB.`);
      chunks.push(c as Buffer);
    }
    return { name: dl.suggestedFilename(), mime: "application/octet-stream", base64: Buffer.concat(chunks).toString("base64") };
  }

  async close(): Promise<void> {
    for (const s of this.sessions.values()) await s.context.close().catch(() => undefined);
    this.sessions.clear();
    const b = this.browser && (await this.browser.catch(() => undefined));
    await b?.close().catch(() => undefined);
    this.browser = undefined;
  }
}
