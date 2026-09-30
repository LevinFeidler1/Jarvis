import { ImapFlow, type FetchMessageObject, type MessageStructureObject, type SearchObject } from "imapflow";
import { simpleParser, type AddressObject } from "mailparser";
import nodemailer, { type Transporter } from "nodemailer";
import MailComposer from "nodemailer/lib/mail-composer/index.js";
import { ToolError } from "../../core/types.js";
import { htmlToText } from "../google/mime.js";
import type {
  Email,
  EmailAddress,
  EmailDraft,
  EmailProvider,
  EmailSummary,
  ListEmailsQuery,
  OutgoingEmail,
  SendResult,
} from "../types.js";
import type { EmailAccountWithSecret } from "./accounts.js";

const MAX_BODY_CHARS = 20_000;
const SNIPPET_BYTES = 8_000;

type SpecialUse = "\\Sent" | "\\Drafts" | "\\Trash" | "\\Archive" | "\\Junk";

/** Folder fallbacks for servers without SPECIAL-USE (common with German hosters). */
const FOLDER_NAMES: Record<SpecialUse, string[]> = {
  "\\Sent": ["Gesendet", "Gesendete Objekte", "Gesendete Elemente", "Sent", "Sent Items", "Sent Messages", "INBOX.Sent"],
  "\\Drafts": ["Entwürfe", "Entwurf", "Drafts", "INBOX.Drafts"],
  "\\Trash": ["Papierkorb", "Gelöschte Objekte", "Gelöscht", "Trash", "Deleted Items", "INBOX.Trash"],
  "\\Archive": ["Archiv", "Archive", "INBOX.Archiv", "INBOX.Archive"],
  "\\Junk": ["Spam", "Junk", "Junk-E-Mail", "INBOX.Spam"],
};
const CREATE_NAMES: Record<SpecialUse, string> = {
  "\\Sent": "Gesendet",
  "\\Drafts": "Entwürfe",
  "\\Trash": "Papierkorb",
  "\\Archive": "Archiv",
  "\\Junk": "Spam",
};

/** Message ids: "<base64url(folder)>.<uid>" — stable within a folder (UIDVALIDITY). */
export function encodeId(folder: string, uid: number): string {
  return `${Buffer.from(folder, "utf8").toString("base64url")}.${uid}`;
}
export function decodeId(id: string): { folder: string; uid: number } {
  const m = id.match(/^([A-Za-z0-9_-]*)\.(\d+)$/);
  if (!m) throw new ToolError("Ungültige E-Mail-ID", "INVALID_INPUT");
  return { folder: Buffer.from(m[1]!, "base64url").toString("utf8") || "INBOX", uid: Number(m[2]) };
}

function toAddr(a: { name?: string; address?: string } | undefined): EmailAddress {
  return { name: a?.name || undefined, email: a?.address ?? "" };
}

function addrList(obj: AddressObject | AddressObject[] | undefined): EmailAddress[] {
  const list = Array.isArray(obj) ? obj : obj ? [obj] : [];
  return list.flatMap((o) => o.value.map((v) => ({ name: v.name || undefined, email: v.address ?? "" })));
}

function hasAttachment(node: MessageStructureObject | undefined): boolean {
  if (!node) return false;
  if (node.disposition === "attachment") return true;
  return (node.childNodes ?? []).some(hasAttachment);
}

function mapError(err: unknown, account: string): ToolError {
  if (err instanceof ToolError) return err;
  const e = err as { authenticationFailed?: boolean; code?: string; responseCode?: number; message?: string };
  if (e?.authenticationFailed || e?.code === "EAUTH" || e?.responseCode === 535) {
    return new ToolError(`Anmeldung bei ${account} fehlgeschlagen — Benutzername oder Passwort prüfen.`, "AUTH_FAILED");
  }
  if (e?.code && ["ENOTFOUND", "ECONNREFUSED", "ETIMEDOUT", "ECONNRESET", "EHOSTUNREACH", "ESOCKET", "ECONNECTION"].includes(e.code)) {
    return new ToolError(`Mailserver für ${account} nicht erreichbar (${e.code}).`, "UPSTREAM_ERROR");
  }
  return new ToolError(`Fehler beim Postfach ${account}: ${(e?.message ?? String(err)).slice(0, 200)}`, "UPSTREAM_ERROR");
}

export interface ImapDeps {
  createClient?: (acct: EmailAccountWithSecret) => ImapFlow;
  createTransport?: (acct: EmailAccountWithSecret) => Pick<Transporter, "sendMail" | "verify">;
}

/**
 * Standard IMAP (read, organise) + SMTP (send) mailbox — works with 1&1/IONOS,
 * All-Inkl and practically every other provider. Each call opens a short-lived
 * connection (serverless-friendly). Sending is never retried automatically.
 */
export class ImapEmailProvider implements EmailProvider {
  readonly name: string;

  constructor(
    private readonly acct: EmailAccountWithSecret,
    private readonly deps: ImapDeps = {},
  ) {
    this.name = acct.email;
  }

  private client(): ImapFlow {
    if (this.deps.createClient) return this.deps.createClient(this.acct);
    return new ImapFlow({
      host: this.acct.imap.host,
      port: this.acct.imap.port,
      secure: this.acct.imap.secure,
      auth: { user: this.acct.username, pass: this.acct.password },
      logger: false,
      socketTimeout: 30_000,
      connectionTimeout: 15_000,
    } as ConstructorParameters<typeof ImapFlow>[0]);
  }

  private transport() {
    if (this.deps.createTransport) return this.deps.createTransport(this.acct);
    return nodemailer.createTransport({
      host: this.acct.smtp.host,
      port: this.acct.smtp.port,
      secure: this.acct.smtp.secure,
      requireTLS: !this.acct.smtp.secure,
      auth: { user: this.acct.username, pass: this.acct.password },
      connectionTimeout: 15_000,
      socketTimeout: 30_000,
    });
  }

  private async withClient<T>(fn: (c: ImapFlow) => Promise<T>): Promise<T> {
    const c = this.client();
    c.on("error", () => undefined); // errors surface via the awaited calls
    try {
      await c.connect();
    } catch (err) {
      throw mapError(err, this.acct.email);
    }
    try {
      return await fn(c);
    } catch (err) {
      throw mapError(err, this.acct.email);
    } finally {
      await c.logout().catch(() => c.close());
    }
  }

  private async folder(c: ImapFlow, use: SpecialUse, create: boolean): Promise<string | undefined> {
    const boxes = await c.list();
    const special = boxes.find((b) => b.specialUse === use);
    if (special) return special.path;
    const names = FOLDER_NAMES[use].map((n) => n.toLowerCase());
    const byName = boxes.find((b) => names.includes(b.path.toLowerCase()) || names.includes(b.name.toLowerCase()));
    if (byName) return byName.path;
    if (!create) return undefined;
    return (await c.mailboxCreate(CREATE_NAMES[use])).path;
  }

  /** Test login for IMAP and SMTP (used before an account is saved). */
  async verify(): Promise<void> {
    await this.withClient(async (c) => {
      await c.mailboxOpen("INBOX", { readOnly: true });
    });
    try {
      await this.transport().verify();
    } catch (err) {
      throw mapError(err, `${this.acct.email} (SMTP)`);
    }
  }

  async listEmails(q: ListEmailsQuery): Promise<EmailSummary[]> {
    const max = Math.min(q.maxResults ?? 20, 50);
    return this.withClient(async (c) => {
      const folders: string[] = [];
      if (q.label) folders.push(q.label);
      else {
        folders.push("INBOX");
        if (q.inboxOnly === false) {
          for (const use of ["\\Sent", "\\Archive"] as const) {
            const f = await this.folder(c, use, false);
            if (f) folders.push(f);
          }
        }
      }
      const criteria: SearchObject = {};
      if (q.unreadOnly) criteria.seen = false;
      if (q.newerThanDays) criteria.since = new Date(Date.now() - q.newerThanDays * 86_400_000);
      if (q.from) criteria.from = q.from;
      if (q.text) criteria.or = [{ subject: q.text }, { body: q.text }, { from: q.text }];
      if (Object.keys(criteria).length === 0) criteria.all = true;

      const out: EmailSummary[] = [];
      for (const folder of folders) {
        const lock = await c.getMailboxLock(folder, { readOnly: true }).catch(() => undefined);
        if (!lock) continue;
        try {
          const uids = (await c.search(criteria, { uid: true })) || [];
          const pick = [...uids].sort((a, b) => b - a).slice(0, max);
          if (!pick.length) continue;
          const msgs = await c.fetchAll(
            pick.join(","),
            { uid: true, envelope: true, flags: true, internalDate: true, bodyStructure: true, source: { start: 0, maxLength: SNIPPET_BYTES } },
            { uid: true },
          );
          for (const m of msgs) out.push(await this.summary(folder, m));
        } finally {
          lock.release();
        }
      }
      return out.sort((a, b) => b.date.localeCompare(a.date)).slice(0, max);
    });
  }

  private async summary(folder: string, m: FetchMessageObject): Promise<EmailSummary> {
    let snippet = "";
    if (m.source) {
      try {
        const parsed = await simpleParser(m.source, { skipHtmlToText: false, skipImageLinks: true });
        snippet = (parsed.text || htmlToText(typeof parsed.html === "string" ? parsed.html : "")).replace(/\s+/g, " ").trim().slice(0, 200);
      } catch {
        /* truncated source may not parse — snippet stays empty */
      }
    }
    const env = m.envelope;
    const date = m.internalDate ? new Date(m.internalDate) : env?.date ? new Date(env.date) : new Date(0);
    return {
      id: encodeId(folder, m.uid),
      threadId: env?.messageId ?? `${folder}:${m.uid}`,
      from: toAddr(env?.from?.[0]),
      to: (env?.to ?? []).map(toAddr),
      subject: env?.subject || "(kein Betreff)",
      snippet,
      date: date.toISOString(),
      unread: !m.flags?.has("\\Seen"),
      labels: [folder],
      hasAttachments: hasAttachment(m.bodyStructure),
    };
  }

  async readEmail(id: string): Promise<Email> {
    const { folder, uid } = decodeId(id);
    return this.withClient(async (c) => {
      const lock = await c.getMailboxLock(folder, { readOnly: true });
      try {
        const m = await c.fetchOne(String(uid), { uid: true, envelope: true, flags: true, internalDate: true, bodyStructure: true, source: true }, { uid: true });
        if (!m || !m.source) throw new ToolError("E-Mail nicht gefunden (evtl. verschoben oder gelöscht).", "NOT_FOUND");
        const base = await this.summary(folder, { ...m, source: undefined });
        const parsed = await simpleParser(m.source);
        let body = parsed.text || htmlToText(typeof parsed.html === "string" ? parsed.html : "");
        if (body.length > MAX_BODY_CHARS) body = `${body.slice(0, MAX_BODY_CHARS)}\n[… gekürzt]`;
        const refs = parsed.references;
        const unsub = parsed.headers.get("list-unsubscribe");
        return {
          ...base,
          from: addrList(parsed.from)[0] ?? base.from,
          to: addrList(parsed.to),
          cc: addrList(parsed.cc),
          snippet: body.replace(/\s+/g, " ").slice(0, 200),
          bodyText: body,
          messageIdHeader: parsed.messageId,
          references: Array.isArray(refs) ? refs.join(" ") : refs,
          listUnsubscribe: unsub ? String(typeof unsub === "object" ? JSON.stringify(unsub) : unsub) : undefined,
          attachments: parsed.attachments.map((a) => ({ filename: a.filename ?? "Anhang", mimeType: a.contentType, size: a.size })),
        };
      } finally {
        lock.release();
      }
    });
  }

  private async compose(input: OutgoingEmail & { inReplyTo?: string; references?: string }): Promise<{ raw: Buffer; recipients: string[] }> {
    const from = this.acct.name ? { name: this.acct.name, address: this.acct.email } : this.acct.email;
    const mail = new MailComposer({
      from,
      to: input.to,
      cc: input.cc,
      bcc: input.bcc,
      subject: input.subject,
      text: input.body,
      inReplyTo: input.inReplyTo,
      references: input.references,
      date: new Date(),
    });
    const node = mail.compile();
    node.keepBcc = false;
    const raw = await node.build();
    return { raw, recipients: [...input.to, ...(input.cc ?? []), ...(input.bcc ?? [])] };
  }

  private async replyHeaders(input: OutgoingEmail): Promise<OutgoingEmail & { inReplyTo?: string; references?: string }> {
    if (!input.replyToMessageId) return input;
    const orig = await this.readEmail(input.replyToMessageId);
    const subject = input.subject || (/^re:/i.test(orig.subject) ? orig.subject : `Re: ${orig.subject}`);
    const references = [orig.references, orig.messageIdHeader].filter(Boolean).join(" ") || undefined;
    return { ...input, subject, inReplyTo: orig.messageIdHeader, references };
  }

  async draftEmail(input: OutgoingEmail): Promise<EmailDraft> {
    const { raw } = await this.compose(await this.replyHeaders(input));
    return this.withClient(async (c) => {
      const drafts = (await this.folder(c, "\\Drafts", true))!;
      const res = await c.append(drafts, raw, ["\\Draft", "\\Seen"]);
      return { id: res && res.uid ? encodeId(drafts, res.uid) : `${drafts}:neu` };
    });
  }

  private async deliver(msg: OutgoingEmail & { inReplyTo?: string; references?: string }): Promise<SendResult> {
    const { raw, recipients } = await this.compose(msg);
    let info: { messageId?: string };
    try {
      info = await this.transport().sendMail({ envelope: { from: this.acct.email, to: recipients }, raw });
    } catch (err) {
      throw mapError(err, `${this.acct.email} (SMTP)`);
    }
    // Most German hosters do not store SMTP-sent mail automatically → copy to "Gesendet".
    await this.withClient(async (c) => {
      const sent = await this.folder(c, "\\Sent", true);
      if (sent) await c.append(sent, raw, ["\\Seen"]);
    }).catch(() => undefined);
    return { id: info.messageId ?? "gesendet" };
  }

  async sendEmail(input: OutgoingEmail): Promise<SendResult> {
    return this.deliver(await this.replyHeaders(input));
  }

  async forwardEmail(id: string, to: string[], note?: string): Promise<SendResult> {
    const orig = await this.readEmail(id);
    const body =
      `${note ? `${note}\n\n` : ""}---------- Weitergeleitete Nachricht ----------\n` +
      `Von: ${orig.from.name ? `${orig.from.name} <${orig.from.email}>` : orig.from.email}\n` +
      `Datum: ${orig.date}\nBetreff: ${orig.subject}\n\n${orig.bodyText}`;
    return this.deliver({ to, subject: /^fwd?:/i.test(orig.subject) ? orig.subject : `Fwd: ${orig.subject}`, body });
  }

  private async withMessage(id: string, fn: (c: ImapFlow, uid: string) => Promise<void>): Promise<void> {
    const { folder, uid } = decodeId(id);
    await this.withClient(async (c) => {
      const lock = await c.getMailboxLock(folder);
      try {
        await fn(c, String(uid));
      } finally {
        lock.release();
      }
    });
  }

  markRead(id: string, read: boolean): Promise<void> {
    return this.withMessage(id, async (c, uid) => {
      if (read) await c.messageFlagsAdd(uid, ["\\Seen"], { uid: true });
      else await c.messageFlagsRemove(uid, ["\\Seen"], { uid: true });
    });
  }

  archive(id: string): Promise<void> {
    return this.withMessage(id, async (c, uid) => {
      const target = (await this.folder(c, "\\Archive", true))!;
      await c.messageMove(uid, target, { uid: true });
    });
  }

  trash(id: string): Promise<void> {
    return this.withMessage(id, async (c, uid) => {
      const target = (await this.folder(c, "\\Trash", true))!;
      await c.messageMove(uid, target, { uid: true });
    });
  }

  /**
   * IMAP has folders, not labels: "add" moves the message into that folder
   * (created if missing); UNREAD/INBOX map to flags/archive.
   */
  async modifyLabels(id: string, change: { add?: string[]; remove?: string[] }): Promise<void> {
    const add = (change.add ?? []).filter(Boolean);
    const remove = (change.remove ?? []).filter(Boolean);
    if (add.some((l) => l.toUpperCase() === "UNREAD")) await this.markRead(id, false);
    if (remove.some((l) => l.toUpperCase() === "UNREAD")) await this.markRead(id, true);
    const target = add.find((l) => !["UNREAD", "INBOX", "IMPORTANT", "STARRED"].includes(l.toUpperCase()));
    if (target) {
      await this.withMessage(id, async (c, uid) => {
        const boxes = await c.list();
        const existing = boxes.find((b) => b.path.toLowerCase() === target.toLowerCase() || b.name.toLowerCase() === target.toLowerCase());
        const path = existing?.path ?? (await c.mailboxCreate(target)).path;
        await c.messageMove(uid, path, { uid: true });
      });
    } else if (remove.some((l) => l.toUpperCase() === "INBOX")) {
      await this.archive(id);
    }
  }
}
