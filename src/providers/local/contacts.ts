import { randomUUID } from "node:crypto";
import type { Db } from "../../db/database.js";
import { nowIso } from "../../db/database.js";
import { ToolError } from "../../core/types.js";
import type { Contact, ContactInput, ContactProvider } from "../types.js";

/** Ids of contacts stored in JARVIS; Google ids look like people/… or otherContacts/…. */
export const LOCAL_CONTACT_PREFIX = "jarvis:";

interface Row {
  id: string;
  name: string;
  emails: string;
  phones: string;
  organization: string | null;
  role: string | null;
  notes: string | null;
}

const SELECT = "SELECT id, name, emails, phones, organization, role, notes FROM contacts";

function toContact(r: Row): Contact {
  return {
    id: `${LOCAL_CONTACT_PREFIX}${r.id}`,
    name: r.name,
    emails: JSON.parse(r.emails) as string[],
    phones: JSON.parse(r.phones) as string[],
    organization: r.organization ?? undefined,
    role: r.role ?? undefined,
    notes: r.notes ?? undefined,
    source: "jarvis",
  };
}

const clean = (list: string[] | undefined): string[] => [...new Set((list ?? []).map((v) => v.trim()).filter(Boolean))];
const opt = (v: string | undefined | null): string | null => (v && v.trim() ? v.trim() : null);

/** Contacts maintained directly in JARVIS — no Google account needed. */
export class LocalContactProvider implements ContactProvider {
  readonly name = "JARVIS-Kontakte";
  constructor(private readonly db: Db) {}

  private rawId(id: string): string {
    if (!id.startsWith(LOCAL_CONTACT_PREFIX)) throw new ToolError(`Kontakt ${id} nicht gefunden`, "NOT_FOUND");
    return id.slice(LOCAL_CONTACT_PREFIX.length);
  }

  async list(): Promise<Contact[]> {
    return (await this.db.query<Row>(`${SELECT} ORDER BY lower(name)`)).map(toContact);
  }

  async searchContacts(query: string, max = 10): Promise<Contact[]> {
    const q = `%${query.trim().toLowerCase().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    const rows = await this.db.query<Row>(
      `${SELECT} WHERE lower(name) LIKE $1 OR lower(emails) LIKE $1 OR lower(coalesce(organization, '')) LIKE $1
         OR replace(phones, ' ', '') LIKE replace($1, ' ', '')
       ORDER BY lower(name) LIKE $2 DESC, lower(name) LIMIT $3`,
      [q, `${query.trim().toLowerCase()}%`, max],
    );
    return rows.map(toContact);
  }

  async getContact(id: string): Promise<Contact> {
    const r = await this.db.one<Row>(`${SELECT} WHERE id = $1`, [this.rawId(id)]);
    if (!r) throw new ToolError(`Kontakt ${id} nicht gefunden`, "NOT_FOUND");
    return toContact(r);
  }

  async createContact(input: ContactInput): Promise<Contact> {
    const name = input.name.trim();
    if (!name) throw new ToolError("Ein Kontakt braucht einen Namen.", "INVALID_INPUT");
    const id = randomUUID();
    const ts = nowIso();
    await this.db.run(
      `INSERT INTO contacts (id, name, emails, phones, organization, role, notes, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)`,
      [id, name, JSON.stringify(clean(input.emails)), JSON.stringify(clean(input.phones)), opt(input.organization), opt(input.role), opt(input.notes), ts],
    );
    return this.getContact(`${LOCAL_CONTACT_PREFIX}${id}`);
  }

  async updateContact(id: string, patch: Partial<ContactInput>): Promise<Contact> {
    const c = await this.getContact(id);
    const next = { ...c, ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) } as Contact;
    if (!next.name.trim()) throw new ToolError("Ein Kontakt braucht einen Namen.", "INVALID_INPUT");
    await this.db.run(
      "UPDATE contacts SET name = $1, emails = $2, phones = $3, organization = $4, role = $5, notes = $6, updated_at = $7 WHERE id = $8",
      [next.name.trim(), JSON.stringify(clean(next.emails)), JSON.stringify(clean(next.phones)), opt(next.organization), opt(next.role), opt(next.notes), nowIso(), this.rawId(id)],
    );
    return this.getContact(id);
  }

  async deleteContact(id: string): Promise<boolean> {
    const n = await this.db.run("DELETE FROM contacts WHERE id = $1", [this.rawId(id)]);
    return n > 0;
  }

  /** Imports parsed vCards; skips entries whose e-mail (or, without e-mail, name) already exists. */
  async importContacts(list: ContactInput[]): Promise<{ imported: number; skipped: number }> {
    const existing = await this.list();
    const emails = new Set(existing.flatMap((c) => c.emails.map((e) => e.toLowerCase())));
    const names = new Set(existing.map((c) => c.name.toLowerCase()));
    let imported = 0;
    let skipped = 0;
    for (const c of list) {
      const mails = clean(c.emails).map((e) => e.toLowerCase());
      const dup = mails.length ? mails.some((e) => emails.has(e)) : names.has(c.name.trim().toLowerCase());
      if (dup || !c.name.trim()) {
        skipped++;
        continue;
      }
      await this.createContact(c);
      mails.forEach((e) => emails.add(e));
      names.add(c.name.trim().toLowerCase());
      imported++;
    }
    return { imported, skipped };
  }
}
