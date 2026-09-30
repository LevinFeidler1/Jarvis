import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { CombinedContacts } from "../src/providers/combined-contacts.js";
import { LocalContactProvider } from "../src/providers/local/contacts.js";
import { parseVCards, toVCards } from "../src/providers/local/vcard.js";
import type { ContactProvider } from "../src/providers/types.js";
import { createServer } from "../src/server.js";
import { createDefaultRegistry } from "../src/tools/registry.js";
import { FakeContacts, harness, message, testDb, text, toolUse } from "./helpers.js";

describe("JARVIS contacts (without Google)", () => {
  it("creates, searches, updates and deletes contacts", async () => {
    const store = new LocalContactProvider(await testDb());
    const anna = await store.createContact({ name: " Anna Schmidt ", emails: ["anna@example.com", "anna@example.com"], phones: ["+49 170 1234567"], organization: "Bäckerei Schulz" });
    await store.createContact({ name: "Max Schneider", emails: ["max@example.com"] });
    expect(anna).toMatchObject({ name: "Anna Schmidt", emails: ["anna@example.com"], source: "jarvis" });
    expect(anna.id).toMatch(/^jarvis:/);

    expect((await store.searchContacts("anna")).map((c) => c.name)).toEqual(["Anna Schmidt"]);
    expect((await store.searchContacts("bäckerei")).map((c) => c.name)).toEqual(["Anna Schmidt"]);
    expect((await store.searchContacts("max@example")).map((c) => c.name)).toEqual(["Max Schneider"]);
    expect((await store.searchContacts("1701234567")).map((c) => c.name)).toEqual(["Anna Schmidt"]);
    expect(await store.searchContacts("%")).toEqual([]); // LIKE wildcards are escaped

    const updated = await store.updateContact(anna.id, { role: "Inhaberin", notes: "duzen" });
    expect(updated).toMatchObject({ role: "Inhaberin", notes: "duzen", emails: ["anna@example.com"] });
    expect(await store.deleteContact(anna.id)).toBe(true);
    await expect(store.getContact(anna.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(store.getContact("people/c1")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("the agent saves and finds contacts although Google is not connected", async () => {
    const h = await harness(
      [
        message([toolUse("create_contact", { name: "Anna Schmidt", emails: ["anna@example.com"] })]),
        message([text("Gespeichert.")]),
        message([toolUse("search_contact", { query: "Anna" })]),
        (req) => {
          const last = req.messages.at(-1)!.content as Array<{ content: string; is_error: boolean }>;
          expect(last[0]!.is_error).toBe(false);
          expect(last[0]!.content).toContain("anna@example.com");
          return message([text("Anna Schmidt: anna@example.com")]);
        },
      ],
      { connect: false },
    );
    await h.agent.handleUserMessage(undefined, "Speichere Anna Schmidt, anna@example.com");
    const r = await h.agent.handleUserMessage(undefined, "Wie ist Annas Adresse?");
    expect(r.text).toContain("anna@example.com");
    expect(await h.providers.localContacts.list()).toHaveLength(1);
  });

  it("refuses save_to=google honestly when Google is not connected", async () => {
    const combined = new CombinedContacts(new LocalContactProvider(await testDb()));
    await expect(combined.createContact({ name: "X", target: "google" })).rejects.toMatchObject({ code: "NOT_CONFIGURED" });
  });
});

describe("combined contacts (JARVIS + Google)", () => {
  it("merges results, prefers JARVIS entries and routes ids to the owner", async () => {
    const local = new LocalContactProvider(await testDb());
    await local.createContact({ name: "Anna Schmidt", emails: ["anna@example.com"] });
    const google = new FakeContacts([
      { id: "people/c1", name: "Anna S.", emails: ["ANNA@example.com"], phones: [], source: "contacts" },
      { id: "people/c2", name: "Anna Berg", emails: ["berg@example.com"], phones: [], source: "contacts" },
    ]);
    const combined = new CombinedContacts(local, google);
    const hits = await combined.searchContacts("anna");
    expect(hits.map((c) => c.name)).toEqual(["Anna Schmidt", "Anna Berg"]);
    expect((await combined.getContact("people/c2")).name).toBe("Anna Berg");
    const created = await combined.createContact({ name: "Neu" });
    expect(created.id).toMatch(/^jarvis:/);
    expect((await combined.createContact({ name: "Neu G", target: "google" })).id).toMatch(/^people\//);
  });

  it("still returns JARVIS contacts when Google fails, and says so", async () => {
    const local = new LocalContactProvider(await testDb());
    await local.createContact({ name: "Anna Schmidt" });
    const broken = { name: "Google", searchContacts: async () => { throw new Error("HTTP 503"); } } as unknown as ContactProvider;
    const combined = new CombinedContacts(local, broken);
    expect((await combined.searchContacts("anna")).map((c) => c.name)).toEqual(["Anna Schmidt"]);
    expect(combined.lastFailure).toContain("HTTP 503");
  });
});

describe("vCard import/export", () => {
  it("parses vCard 3.0 with folding, groups and escapes", () => {
    const vcf = [
      "BEGIN:VCARD",
      "VERSION:3.0",
      "N:Schmidt;Anna;;;",
      "FN:Anna Schmidt",
      "item1.EMAIL;type=INTERNET;type=pref:anna@example.com",
      "EMAIL:kein-mail",
      "TEL;TYPE=CELL:+49 170 1234567",
      "ORG:Bäckerei Schulz\\, GmbH;Vertrieb",
      "NOTE:Erste Zeile\\nzweite",
      "  Zeile fortgesetzt",
      "END:VCARD",
      "BEGIN:VCARD",
      "VERSION:3.0",
      "N:Schneider;Max;;Dr.;",
      "END:VCARD",
    ].join("\r\n");
    const [anna, max] = parseVCards(vcf);
    expect(anna).toMatchObject({
      name: "Anna Schmidt",
      emails: ["anna@example.com"],
      phones: ["+49 170 1234567"],
      organization: "Bäckerei Schulz, GmbH, Vertrieb",
      notes: "Erste Zeile\nzweite Zeile fortgesetzt",
    });
    expect(max!.name).toBe("Dr. Max Schneider");
  });

  it("decodes vCard 2.1 quoted-printable (old Android/Outlook exports)", () => {
    const vcf = "BEGIN:VCARD\nVERSION:2.1\nFN;CHARSET=UTF-8;ENCODING=QUOTED-PRINTABLE:J=C3=BCrgen M=C3=BCller\nEMAIL;HOME:juergen@example.de\nEND:VCARD\n";
    expect(parseVCards(vcf)).toEqual([expect.objectContaining({ name: "Jürgen Müller", emails: ["juergen@example.de"] })]);
  });

  it("round-trips through export and skips duplicates on re-import", async () => {
    const store = new LocalContactProvider(await testDb());
    const first = await store.importContacts(parseVCards("BEGIN:VCARD\nFN:Anna; Test\nEMAIL:anna@example.com\nNOTE:a\\, b\nEND:VCARD\nBEGIN:VCARD\nFN:Ohne Mail\nEND:VCARD"));
    expect(first).toEqual({ imported: 2, skipped: 0 });
    const again = await store.importContacts(parseVCards(toVCards(await store.list())));
    expect(again).toEqual({ imported: 0, skipped: 2 });
    expect((await store.list()).find((c) => c.emails.length)).toMatchObject({ name: "Anna; Test", notes: "a, b" });
  });
});

describe("contacts HTTP API", () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it("CRUD, import and export for the Kontakte page", async () => {
    const h = await harness([], { connect: false });
    app = await createServer({ config: h.config, db: h.db, agent: h.agent, providers: h.providers, memory: h.memory, registry: createDefaultRegistry(), scheduler: h.scheduler, llmConfigured: true });
    const login = await app.inject({ method: "POST", url: "/api/login", payload: { token: "t".repeat(40) } });
    const cookie = `jarvis_session=${login.cookies.find((c) => c.name === "jarvis_session")!.value}`;
    const headers = { cookie, "x-jarvis-csrf": login.json().csrfToken as string, origin: "http://localhost:3000" };

    const created = await app.inject({ method: "POST", url: "/api/contacts", headers, payload: { name: "Anna", emails: ["anna@example.com"] } });
    expect(created.statusCode).toBe(200);
    const id = created.json().id as string;
    expect((await app.inject({ method: "POST", url: "/api/contacts", headers, payload: { name: "X", emails: ["nope"] } })).statusCode).toBe(400);

    const patched = await app.inject({ method: "PATCH", url: `/api/contacts/${encodeURIComponent(id)}`, headers, payload: { phones: ["+49 40 123"] } });
    expect(patched.json()).toMatchObject({ name: "Anna", phones: ["+49 40 123"] });

    const imp = await app.inject({ method: "POST", url: "/api/contacts/import", headers, payload: { vcf: "BEGIN:VCARD\nFN:Max\nEMAIL:max@example.com\nEND:VCARD" } });
    expect(imp.json()).toEqual({ imported: 1, skipped: 0 });
    expect((await app.inject({ method: "POST", url: "/api/contacts/import", headers, payload: { vcf: "hallo" } })).statusCode).toBe(400);

    const list = await app.inject({ url: "/api/contacts", headers: { cookie } });
    expect(list.json()).toMatchObject({ google: false, contacts: [{ name: "Anna" }, { name: "Max" }] });
    expect((await app.inject({ url: "/api/contacts?q=max", headers: { cookie } })).json().contacts).toHaveLength(1);

    const exp = await app.inject({ url: "/api/contacts/export", headers: { cookie } });
    expect(exp.headers["content-type"]).toContain("text/vcard");
    expect(exp.body).toContain("FN:Max");

    expect((await app.inject({ method: "DELETE", url: `/api/contacts/${encodeURIComponent(id)}`, headers })).statusCode).toBe(200);
    expect((await app.inject({ method: "DELETE", url: "/api/contacts/people%2Fc1", headers })).statusCode).toBe(400);
    expect((await app.inject({ url: "/api/contacts", headers: { cookie } })).json().contacts).toHaveLength(1);
  });
});
