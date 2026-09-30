import { ToolError } from "../core/types.js";
import type {
  Email,
  EmailAccountInfo,
  EmailDraft,
  EmailProvider,
  EmailSummary,
  ListEmailsQuery,
  MultiListResult,
  OutgoingEmail,
  SendResult,
} from "./types.js";

export interface MailboxEntry {
  /** Account e-mail address (lower case) — also the routing key in message ids. */
  email: string;
  name: string;
  kind: "gmail" | "imap";
  provider: EmailProvider;
}

const SEP = "|";

/** "<account>|<provider id>" — lets every operation reach the right mailbox. */
export function accountOfId(id: string): string | undefined {
  const i = id.indexOf(SEP);
  return i > 0 ? id.slice(0, i) : undefined;
}

/**
 * Presents several mailboxes (Gmail + IMAP accounts) as one EmailProvider.
 * Reads fan out to all accounts; writes are routed by message id or by the
 * explicit sending account. Never guesses the sender when it is ambiguous.
 */
export class MultiAccountEmail implements EmailProvider {
  readonly name = "Alle Postfächer";

  constructor(
    private readonly entries: MailboxEntry[],
    private readonly defaultAccount: string | null,
  ) {}

  accounts(): EmailAccountInfo[] {
    return this.entries.map((e) => ({ email: e.email, name: e.name, kind: e.kind, isDefault: e.email === this.effectiveDefault() }));
  }

  private effectiveDefault(): string | null {
    if (this.entries.length === 1) return this.entries[0]!.email;
    return this.defaultAccount && this.entries.some((e) => e.email === this.defaultAccount) ? this.defaultAccount : null;
  }

  private find(account: string): MailboxEntry {
    const key = account.trim().toLowerCase();
    const e = this.entries.find((x) => x.email === key || x.name.toLowerCase() === key);
    if (!e) {
      throw new ToolError(`Unbekanntes Postfach „${account}“. Verbunden: ${this.entries.map((x) => x.email).join(", ")}`, "INVALID_INPUT");
    }
    return e;
  }

  private route(id: string): { entry: MailboxEntry; raw: string } {
    const acct = accountOfId(id);
    if (!acct) throw new ToolError("E-Mail-ID ohne Postfach-Angabe. Bitte die ID aus list_emails/search_emails verwenden.", "INVALID_INPUT");
    return { entry: this.find(acct), raw: id.slice(acct.length + SEP.length) };
  }

  private tag(entry: MailboxEntry, m: EmailSummary): EmailSummary {
    return { ...m, id: `${entry.email}${SEP}${m.id}`, account: entry.email };
  }

  async listAcrossAccounts(q: ListEmailsQuery): Promise<MultiListResult> {
    const targets = q.account ? [this.find(q.account)] : this.entries;
    const results = await Promise.allSettled(targets.map((e) => e.provider.listEmails({ ...q, account: undefined })));
    const emails: EmailSummary[] = [];
    const failures: MultiListResult["failures"] = [];
    results.forEach((r, i) => {
      const entry = targets[i]!;
      if (r.status === "fulfilled") emails.push(...r.value.map((m) => this.tag(entry, m)));
      else failures.push({ account: entry.email, error: r.reason instanceof Error ? r.reason.message : String(r.reason) });
    });
    if (failures.length === targets.length && targets.length > 0) {
      throw new ToolError(`Kein Postfach erreichbar: ${failures.map((f) => `${f.account}: ${f.error}`).join("; ")}`, "UPSTREAM_ERROR");
    }
    emails.sort((a, b) => b.date.localeCompare(a.date));
    return { emails: emails.slice(0, Math.min(q.maxResults ?? 20, 50)), failures };
  }

  async listEmails(q: ListEmailsQuery): Promise<EmailSummary[]> {
    return (await this.listAcrossAccounts(q)).emails;
  }

  async readEmail(id: string): Promise<Email> {
    const { entry, raw } = this.route(id);
    const m = await entry.provider.readEmail(raw);
    return { ...m, ...this.tag(entry, m) } as Email;
  }

  /** Mailbox that will send: original's mailbox for replies, else explicit, else default. */
  resolveSender(input: Pick<OutgoingEmail, "replyToMessageId" | "fromAccount">): MailboxEntry {
    if (input.replyToMessageId) {
      const { entry } = this.route(input.replyToMessageId);
      if (input.fromAccount && this.find(input.fromAccount).email !== entry.email) {
        throw new ToolError(
          `Antworten gehen immer vom Postfach der ursprünglichen E-Mail (${entry.email}), nicht von ${input.fromAccount}.`,
          "INVALID_INPUT",
        );
      }
      return entry;
    }
    if (input.fromAccount) return this.find(input.fromAccount);
    const def = this.effectiveDefault();
    if (def) return this.find(def);
    throw new ToolError(
      `Von welchem Postfach soll gesendet werden? Verfügbar: ${this.entries.map((e) => e.email).join(", ")}. ` +
        "Frag den Benutzer und setze from_account.",
      "AMBIGUOUS",
    );
  }

  async draftEmail(input: OutgoingEmail): Promise<EmailDraft> {
    const entry = this.resolveSender(input);
    const raw = input.replyToMessageId ? this.route(input.replyToMessageId).raw : undefined;
    const d = await entry.provider.draftEmail({ ...input, replyToMessageId: raw, fromAccount: undefined });
    return { ...d, id: `${entry.email}${SEP}${d.id}` };
  }

  async sendEmail(input: OutgoingEmail): Promise<SendResult> {
    const entry = this.resolveSender(input);
    const raw = input.replyToMessageId ? this.route(input.replyToMessageId).raw : undefined;
    return entry.provider.sendEmail({ ...input, replyToMessageId: raw, fromAccount: undefined });
  }

  async forwardEmail(id: string, to: string[], note?: string): Promise<SendResult> {
    const { entry, raw } = this.route(id);
    return entry.provider.forwardEmail(raw, to, note);
  }

  async modifyLabels(id: string, change: { add?: string[]; remove?: string[] }): Promise<void> {
    const { entry, raw } = this.route(id);
    return entry.provider.modifyLabels(raw, change);
  }

  async markRead(id: string, read: boolean): Promise<void> {
    const { entry, raw } = this.route(id);
    return entry.provider.markRead(raw, read);
  }

  async archive(id: string): Promise<void> {
    const { entry, raw } = this.route(id);
    return entry.provider.archive(raw);
  }

  async trash(id: string): Promise<void> {
    const { entry, raw } = this.route(id);
    return entry.provider.trash(raw);
  }
}
