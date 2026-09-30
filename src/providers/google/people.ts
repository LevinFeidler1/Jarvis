import type { Contact, ContactProvider } from "../types.js";
import type { GoogleHttp } from "./http.js";

const BASE = "https://people.googleapis.com/v1";
const READ_MASK = "names,emailAddresses,phoneNumbers,organizations";

interface GPerson {
  resourceName: string;
  etag?: string;
  names?: Array<{ displayName?: string }>;
  emailAddresses?: Array<{ value?: string }>;
  phoneNumbers?: Array<{ value?: string }>;
  organizations?: Array<{ name?: string; title?: string }>;
}

function toContact(p: GPerson, source: Contact["source"]): Contact {
  const emails = (p.emailAddresses ?? []).map((e) => e.value).filter((v): v is string => !!v);
  return {
    id: p.resourceName,
    name: p.names?.[0]?.displayName ?? emails[0] ?? "(ohne Namen)",
    emails,
    phones: (p.phoneNumbers ?? []).map((e) => e.value).filter((v): v is string => !!v),
    organization: p.organizations?.[0]?.name,
    role: p.organizations?.[0]?.title,
    source,
  };
}

function toPersonBody(input: { name?: string; emails?: string[]; phones?: string[]; organization?: string }) {
  const body: Record<string, unknown> = {};
  const fields: string[] = [];
  if (input.name !== undefined) {
    const [given, ...rest] = input.name.trim().split(/\s+/);
    body.names = [{ givenName: given, familyName: rest.join(" ") || undefined }];
    fields.push("names");
  }
  if (input.emails !== undefined) {
    body.emailAddresses = input.emails.map((value) => ({ value }));
    fields.push("emailAddresses");
  }
  if (input.phones !== undefined) {
    body.phoneNumbers = input.phones.map((value) => ({ value }));
    fields.push("phoneNumbers");
  }
  if (input.organization !== undefined) {
    body.organizations = [{ name: input.organization }];
    fields.push("organizations");
  }
  return { body, fields };
}

export class GoogleContactsProvider implements ContactProvider {
  readonly name = "Google Contacts";
  private warmedUp = false;

  constructor(private readonly http: GoogleHttp) {}

  /** The People search API requires one empty warm-up request per session. */
  private async warmup(): Promise<void> {
    if (this.warmedUp) return;
    await Promise.all([
      this.http.request(`${BASE}/people:searchContacts`, { query: { query: "", readMask: "names" } }).catch(() => undefined),
      this.http.request(`${BASE}/otherContacts:search`, { query: { query: "", readMask: "names" } }).catch(() => undefined),
    ]);
    this.warmedUp = true;
  }

  async searchContacts(query: string, max = 10): Promise<Contact[]> {
    await this.warmup();
    const [saved, other] = await Promise.all([
      this.http.request<{ results?: Array<{ person: GPerson }> }>(`${BASE}/people:searchContacts`, {
        query: { query, readMask: READ_MASK, pageSize: Math.min(max, 30) },
      }),
      this.http
        .request<{ results?: Array<{ person: GPerson }> }>(`${BASE}/otherContacts:search`, {
          query: { query, readMask: "names,emailAddresses,phoneNumbers", pageSize: Math.min(max, 30) },
        })
        .catch(() => ({ results: [] })),
    ]);
    const out = (saved.results ?? []).map((r) => toContact(r.person, "contacts"));
    const known = new Set(out.flatMap((c) => c.emails.map((e) => e.toLowerCase())));
    for (const r of other.results ?? []) {
      const c = toContact(r.person, "other");
      if (c.emails.some((e) => known.has(e.toLowerCase()))) continue;
      out.push(c);
    }
    return out.slice(0, max);
  }

  async getContact(id: string): Promise<Contact> {
    if (!/^(people|otherContacts)\/[A-Za-z0-9_-]+$/.test(id)) throw new Error("Ungültige Kontakt-ID");
    const p = await this.http.request<GPerson>(`${BASE}/${id}`, { query: { personFields: READ_MASK } });
    return toContact(p, id.startsWith("otherContacts/") ? "other" : "contacts");
  }

  async createContact(input: { name: string; emails?: string[]; phones?: string[]; organization?: string }): Promise<Contact> {
    const { body } = toPersonBody(input);
    const p = await this.http.request<GPerson>(`${BASE}/people:createContact`, {
      method: "POST",
      query: { personFields: READ_MASK },
      body,
      idempotent: false,
    });
    return toContact(p, "contacts");
  }

  async updateContact(
    id: string,
    patch: { name?: string; emails?: string[]; phones?: string[]; organization?: string },
  ): Promise<Contact> {
    if (!/^people\/[A-Za-z0-9_-]+$/.test(id)) throw new Error("Nur gespeicherte Kontakte (people/…) können geändert werden.");
    const current = await this.http.request<GPerson>(`${BASE}/${id}`, { query: { personFields: READ_MASK } });
    const { body, fields } = toPersonBody(patch);
    if (fields.length === 0) return toContact(current, "contacts");
    const p = await this.http.request<GPerson>(`${BASE}/${id}:updateContact`, {
      method: "PATCH",
      query: { updatePersonFields: fields.join(","), personFields: READ_MASK },
      body: { ...body, etag: current.etag },
      idempotent: true,
    });
    return toContact(p, "contacts");
  }
}
