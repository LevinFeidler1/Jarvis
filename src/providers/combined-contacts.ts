import { ToolError } from "../core/types.js";
import { LOCAL_CONTACT_PREFIX, type LocalContactProvider } from "./local/contacts.js";
import type { Contact, ContactInput, ContactProvider } from "./types.js";

/**
 * JARVIS contacts plus (optionally) Google Contacts behind one provider.
 * Search covers both; ids route to the owning store. New contacts go to
 * JARVIS unless `target: "google"` is requested.
 */
export class CombinedContacts implements ContactProvider {
  readonly name: string;
  /** Set when Google was queried but failed — reported honestly, local results still returned. */
  lastFailure?: string;

  constructor(
    private readonly local: LocalContactProvider,
    private readonly google?: ContactProvider,
  ) {
    this.name = google ? `JARVIS-Kontakte + ${google.name}` : local.name;
  }

  get hasGoogle(): boolean {
    return !!this.google;
  }

  private owner(id: string): ContactProvider {
    if (id.startsWith(LOCAL_CONTACT_PREFIX)) return this.local;
    if (this.google) return this.google;
    throw new ToolError(`Kontakt ${id} nicht gefunden (Google Kontakte ist nicht verbunden).`, "NOT_FOUND");
  }

  async searchContacts(query: string, max = 10): Promise<Contact[]> {
    this.lastFailure = undefined;
    const local = await this.local.searchContacts(query, max);
    if (!this.google) return local;
    let remote: Contact[] = [];
    try {
      remote = await this.google.searchContacts(query, max);
    } catch (err) {
      this.lastFailure = `Google Kontakte nicht erreichbar: ${err instanceof Error ? err.message : String(err)}`;
    }
    const known = new Set(local.flatMap((c) => c.emails.map((e) => e.toLowerCase())));
    const merged = [...local, ...remote.filter((c) => !c.emails.some((e) => known.has(e.toLowerCase())))];
    return merged.slice(0, max);
  }

  async getContact(id: string): Promise<Contact> {
    return this.owner(id).getContact(id);
  }

  async createContact(input: ContactInput & { target?: "jarvis" | "google" }): Promise<Contact> {
    const { target, ...data } = input;
    if (target === "google") {
      if (!this.google) throw new ToolError("Google Kontakte ist nicht verbunden — Kontakt kann nur in JARVIS gespeichert werden.", "NOT_CONFIGURED");
      return this.google.createContact(data);
    }
    return this.local.createContact(data);
  }

  async updateContact(id: string, patch: Partial<ContactInput>): Promise<Contact> {
    return this.owner(id).updateContact(id, patch);
  }
}
