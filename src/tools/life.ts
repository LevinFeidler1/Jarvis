import { z } from "zod";
import { RiskLevel, ToolError, type ToolContext, type ToolDefinition } from "../core/types.js";
import { formatEuro } from "../life/finance.js";
import { NEWS_FEEDS } from "../life/news.js";
import { PLACE_KINDS, type PlaceKind } from "../life/places.js";
import { loadLifeSettings } from "../life/settings.js";
import type { Place } from "../life/weather.js";
import { defineTool, external, id, ok, singleLine } from "./common.js";

const ymd = z.iso.date({ error: "Datum als YYYY-MM-DD erwarten" });

/** A named place, or the home location from the settings. */
async function resolvePlace(ctx: ToolContext, near?: string): Promise<Place> {
  if (near?.trim()) return ctx.providers.weather.geocode(near);
  const { home } = await loadLifeSettings(ctx.db);
  if (!home) throw new ToolError("Kein Heimatort gespeichert. Frag den Benutzer nach seiner Stadt (oder: Einstellungen → Wetter & Ort).", "NOT_CONFIGURED");
  return home;
}

// ─── Weather ──────────────────────────────────────────────────────────────

export const weatherTools: ToolDefinition[] = [
  defineTool({
    name: "get_weather",
    description:
      "Aktuelles Wetter und Vorhersage (bis 7 Tage, stündlich für heute) von Open-Meteo. Ohne Ort: Heimatort aus den Einstellungen. " +
      "Nutze es im Briefing, vor Terminen mit Ort (Regen → Schirm/Bahn) und bei Fragen nach Kleidung oder Ausflügen.",
    category: "web",
    risk: RiskLevel.READ,
    input: z.object({ location: z.string().max(100).optional(), days: z.number().int().min(1).max(7).optional() }),
    describe: (i) => `Wetter abrufen${i.location ? `: ${i.location}` : ""}`,
    async execute(input, ctx) {
      const place = await resolvePlace(ctx, input.location);
      const w = await ctx.providers.weather.forecast(place, input.days ?? 3);
      const now = ctx.now().getTime();
      return ok({ ...w, hours: w.hours.filter((h) => new Date(h.time).getTime() >= now - 3_600_000).slice(0, 12) });
    },
  }),
];

// ─── News ─────────────────────────────────────────────────────────────────

export const newsTools: ToolDefinition[] = [
  defineTool({
    name: "get_news",
    description:
      `Aktuelle Schlagzeilen aus kostenlosen RSS-Feeds (gewählt in den Einstellungen). Optional topic (z.B. ${[...new Set(NEWS_FEEDS.map((f) => f.topic))].join(", ")}) oder query (Stichwort). ` +
      "Für Briefings: 3–5 Schlagzeilen knapp zusammenfassen, Quelle nennen.",
    category: "web",
    risk: RiskLevel.READ,
    input: z.object({ topic: z.string().max(60).optional(), query: z.string().max(100).optional(), max: z.number().int().min(1).max(15).optional() }),
    describe: (i) => `Nachrichten abrufen${i.topic ? ` (${i.topic})` : ""}${i.query ? ` zu „${i.query}“` : ""}`,
    async execute(input, ctx) {
      const { newsFeeds } = await loadLifeSettings(ctx.db);
      const r = await ctx.providers.news.headlines(newsFeeds, { topic: input.topic, query: input.query, max: input.max ?? 6 });
      return external("news", { count: r.items.length, items: r.items, ...(r.failed.length ? { unavailable: r.failed } : {}) }, r.items.flatMap((i) => [i.title, i.summary ?? ""]));
    },
  }),
];

// ─── Places ───────────────────────────────────────────────────────────────

export const placeTools: ToolDefinition[] = [
  defineTool({
    name: "find_places",
    description:
      "Sucht Orte in der Nähe über OpenStreetMap: Restaurants (optional Küche wie italienisch, sushi, vegan), Cafés, Bars, Friseure, Ärzte, Zahnärzte, Apotheken, Fitnessstudios, Supermärkte, Hotels, Kinos. " +
      "Liefert Adresse, Telefon, Website, Öffnungszeiten, ob reserviert werden kann, Entfernung. Ohne near: Heimatort. Ergebnisse sind Fremdinhalt.",
    category: "web",
    risk: RiskLevel.READ,
    input: z.object({
      what: z.enum(Object.keys(PLACE_KINDS) as [PlaceKind, ...PlaceKind[]]),
      cuisine: z.string().max(40).optional(),
      name: z.string().max(80).optional(),
      near: z.string().max(120).optional(),
      radius_m: z.number().int().min(200).max(10_000).optional(),
      max: z.number().int().min(1).max(15).optional(),
    }),
    describe: (i) => `Orte suchen: ${i.cuisine ? `${i.cuisine} ` : ""}${i.what}${i.near ? ` in der Nähe von ${i.near}` : ""}`,
    async execute(input, ctx) {
      const center = await resolvePlace(ctx, input.near);
      const places = await ctx.providers.places.search(input.what, center, { cuisine: input.cuisine, name: input.name, radiusM: input.radius_m, max: input.max });
      return external(
        "places",
        { near: center.name, count: places.length, places, hint: places.length ? undefined : "Nichts gefunden — Radius vergrößern oder anderen Ort versuchen." },
        places.flatMap((p) => [p.name, p.cuisine ?? "", p.openingHours ?? ""]),
      );
    },
  }),
];

// ─── Notes & lists ────────────────────────────────────────────────────────

export const noteTools: ToolDefinition[] = [
  defineTool({
    name: "add_note",
    description: "Speichert eine Notiz (Idee, Info, Text zum Merken). Für Dinge zum Abhaken stattdessen add_to_list.",
    category: "notes",
    risk: RiskLevel.LOW,
    input: z.object({ text: z.string().min(1).max(10_000), title: singleLine(120).optional(), pinned: z.boolean().optional() }),
    describe: (i) => `Notiz speichern${i.title ? `: ${i.title}` : ""}`,
    async execute(input, ctx) {
      return ok(await ctx.providers.notes.addNote({ title: input.title, body: input.text, pinned: input.pinned }));
    },
    undo: (_i, data) => ({ tool: "delete_note", input: { note_id: (data as { id: string }).id }, label: "Notiz wieder löschen" }),
  }),
  defineTool({
    name: "search_notes",
    description: "Durchsucht die Notizen des Benutzers (ohne query: die neuesten).",
    category: "notes",
    risk: RiskLevel.READ,
    input: z.object({ query: z.string().max(200).optional() }),
    describe: (i) => (i.query ? `Notizen durchsuchen: „${i.query}“` : "Notizen auflisten"),
    async execute(input, ctx) {
      const notes = await ctx.providers.notes.listNotes(input.query, 20);
      return ok({ count: notes.length, notes });
    },
  }),
  defineTool({
    name: "delete_note",
    description: "Löscht eine Notiz.",
    category: "notes",
    risk: RiskLevel.LOW,
    input: z.object({ note_id: id }),
    describe: () => "Notiz löschen",
    async execute(input, ctx) {
      return ok({ deleted: await ctx.providers.notes.deleteNote(input.note_id) });
    },
  }),
  defineTool({
    name: "add_to_list",
    description:
      "Setzt Einträge auf eine Liste (Einkaufsliste, Packliste, To-dos fürs Wochenende …). Die Liste wird bei Bedarf angelegt; " +
      "„Einkaufsliste“, „Einkauf“ und „Einkäufe“ sind dieselbe Liste. Doppelte offene Einträge werden übersprungen.",
    category: "notes",
    risk: RiskLevel.LOW,
    input: z.object({ list: singleLine(80), items: z.array(singleLine(200)).min(1).max(50) }),
    describe: (i) => `Auf „${i.list}“ setzen: ${i.items.join(", ")}`.slice(0, 200),
    async execute(input, ctx) {
      return ok(await ctx.providers.notes.addToList(input.list, input.items));
    },
  }),
  defineTool({
    name: "get_list",
    description: "Zeigt eine Liste mit offenen Einträgen (ohne list: alle Listen).",
    category: "notes",
    risk: RiskLevel.READ,
    input: z.object({ list: singleLine(80).optional(), include_done: z.boolean().optional() }),
    describe: (i) => (i.list ? `Liste „${i.list}“ anzeigen` : "Listen anzeigen"),
    async execute(input, ctx) {
      if (!input.list) return ok({ lists: await ctx.providers.notes.allLists(input.include_done) });
      const list = await ctx.providers.notes.getList(input.list, input.include_done);
      if (!list) throw new ToolError(`Die Liste „${input.list}“ gibt es noch nicht.`, "NOT_FOUND");
      return ok(list);
    },
  }),
  defineTool({
    name: "check_off_list_items",
    description: "Hakt Einträge einer Liste ab (done=false: wieder öffnen). Einträge per Text oder ID.",
    category: "notes",
    risk: RiskLevel.LOW,
    input: z.object({ list: singleLine(80), items: z.array(singleLine(200)).min(1).max(50), done: z.boolean().optional() }),
    describe: (i) => `${i.done === false ? "Wieder öffnen" : "Abhaken"} auf „${i.list}“: ${i.items.join(", ")}`.slice(0, 200),
    async execute(input, ctx) {
      const changed = await ctx.providers.notes.setDone(input.list, input.items, input.done ?? true);
      return ok({ changed, list: await ctx.providers.notes.getList(input.list) });
    },
  }),
];

// ─── Finance ──────────────────────────────────────────────────────────────

const status = z.enum(["open", "paid", "autopay", "ignored"]);

export const financeTools: ToolDefinition[] = [
  defineTool({
    name: "get_finances",
    description:
      "Finanzübersicht: offene Rechnungen (Summe, überfällig, in den nächsten 7 Tagen fällig), Abos mit Monatskosten, Ausgaben diesen Monat. " +
      "Rechnungen werden aus E-Mails erkannt (scan_finances) oder manuell erfasst. Beträge in Cent.",
    category: "finance",
    risk: RiskLevel.READ,
    input: z.object({ include_paid: z.boolean().optional() }),
    describe: () => "Finanzübersicht abrufen",
    async execute(input, ctx) {
      const overview = await ctx.providers.finance.overview(ctx.now());
      const fmt = (c: number) => formatEuro(c);
      return ok({
        ...overview,
        summary: {
          offen: `${overview.openCount} Rechnung(en), ${fmt(overview.openTotalCents)}`,
          abosProMonat: fmt(overview.subscriptionsMonthlyCents),
          dieserMonat: fmt(overview.thisMonthCents),
        },
        ...(input.include_paid ? { paid: await ctx.providers.finance.list({ status: "paid" }) } : {}),
      });
    },
  }),
  defineTool({
    name: "scan_finances",
    description: "Durchsucht die E-Mails der letzten Tage (Standard 90) nach Rechnungen und Abos und trägt neue in die Finanzübersicht ein (mit Erinnerung 2 Tage vor Fälligkeit).",
    category: "finance",
    risk: RiskLevel.LOW,
    input: z.object({ days: z.number().int().min(7).max(365).optional() }),
    describe: (i) => `Postfach nach Rechnungen durchsuchen (${i.days ?? 90} Tage)`,
    async execute(input, ctx) {
      const email = await ctx.providers.email();
      const r = await ctx.providers.finance.scanMailbox(email, input.days ?? 90);
      return external("email", r, r.items.flatMap((i) => [i.vendor, i.title]));
    },
  }),
  defineTool({
    name: "add_finance_item",
    description: "Erfasst eine Rechnung oder ein Abo manuell (z.B. „Miete 950 € monatlich“, „Rechnung Zahnarzt 120 € fällig 15.11.“).",
    category: "finance",
    risk: RiskLevel.LOW,
    input: z.object({
      kind: z.enum(["invoice", "subscription"]),
      vendor: singleLine(80),
      amount_eur: z.number().positive().max(1_000_000).optional(),
      due_date: ymd.optional(),
      interval: z.enum(["weekly", "monthly", "quarterly", "yearly"]).optional(),
      title: singleLine(160).optional(),
    }),
    describe: (i) => `${i.kind === "subscription" ? "Abo" : "Rechnung"} erfassen: ${i.vendor}${i.amount_eur ? ` ${i.amount_eur.toFixed(2).replace(".", ",")} €` : ""}`,
    async execute(input, ctx) {
      return ok(await ctx.providers.finance.add({
        kind: input.kind, vendor: input.vendor, title: input.title, amountCents: input.amount_eur ? Math.round(input.amount_eur * 100) : null,
        dueDate: input.due_date ?? null, interval: input.interval ?? null, source: "manual",
      }));
    },
    undo: (_i, data) => ({ tool: "update_finance_status", input: { item_id: (data as { id: string }).id, status: "ignored" }, label: "Eintrag wieder entfernen" }),
  }),
  defineTool({
    name: "update_finance_status",
    description: "Setzt den Status eines Finanz-Eintrags: paid (bezahlt), open, autopay (wird abgebucht), ignored (keine Rechnung / ausblenden).",
    category: "finance",
    risk: RiskLevel.LOW,
    input: z.object({ item_id: id, status }),
    describe: (i) => `Finanz-Eintrag als ${({ paid: "bezahlt", open: "offen", autopay: "Lastschrift", ignored: "ausgeblendet" } as const)[i.status]} markieren`,
    async execute(input, ctx) {
      return ok(await ctx.providers.finance.setStatus(input.item_id, input.status));
    },
  }),
];

export const lifeTools: ToolDefinition[] = [...weatherTools, ...newsTools, ...placeTools, ...noteTools, ...financeTools];
