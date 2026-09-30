import type {
  Email,
  EmailDraft,
  EmailProvider,
  EmailSummary,
  ListEmailsQuery,
  OutgoingEmail,
  SendResult,
} from "../types.js";
import type { GoogleHttp } from "./http.js";
import { buildRawMessage, htmlToText, parseAddress, parseAddressList } from "./mime.js";

const BASE = "https://gmail.googleapis.com/gmail/v1/users/me";
const MAX_BODY_CHARS = 20_000;

interface GmailHeader {
  name: string;
  value: string;
}
interface GmailPart {
  mimeType?: string;
  filename?: string;
  headers?: GmailHeader[];
  body?: { data?: string; size?: number; attachmentId?: string };
  parts?: GmailPart[];
}
interface GmailMessage {
  id: string;
  threadId: string;
  labelIds?: string[];
  snippet?: string;
  internalDate?: string;
  payload?: GmailPart;
}

function header(msg: GmailMessage, name: string): string | undefined {
  return msg.payload?.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value;
}

function walk(part: GmailPart | undefined, visit: (p: GmailPart) => void): void {
  if (!part) return;
  visit(part);
  part.parts?.forEach((p) => walk(p, visit));
}

function decode(data: string): string {
  return Buffer.from(data, "base64url").toString("utf8");
}

function extractBody(msg: GmailMessage): string {
  let plain = "";
  let html = "";
  walk(msg.payload, (p) => {
    if (p.filename) return;
    if (p.mimeType === "text/plain" && p.body?.data && !plain) plain = decode(p.body.data);
    if (p.mimeType === "text/html" && p.body?.data && !html) html = decode(p.body.data);
  });
  const text = plain || htmlToText(html);
  return text.length > MAX_BODY_CHARS ? `${text.slice(0, MAX_BODY_CHARS)}\n[… gekürzt]` : text;
}

function attachments(msg: GmailMessage): Email["attachments"] {
  const out: Email["attachments"] = [];
  walk(msg.payload, (p) => {
    if (p.filename && p.body?.attachmentId) out.push({ filename: p.filename, mimeType: p.mimeType ?? "", size: p.body.size ?? 0 });
  });
  return out;
}

function toSummary(msg: GmailMessage): EmailSummary {
  const labels = msg.labelIds ?? [];
  return {
    id: msg.id,
    threadId: msg.threadId,
    from: parseAddress(header(msg, "From") ?? ""),
    to: parseAddressList(header(msg, "To")),
    subject: header(msg, "Subject") ?? "(kein Betreff)",
    snippet: msg.snippet ?? "",
    date: msg.internalDate ? new Date(Number(msg.internalDate)).toISOString() : "",
    unread: labels.includes("UNREAD"),
    labels,
    hasAttachments: attachments(msg).length > 0,
  };
}

/** Converts the provider-neutral query into Gmail search syntax. */
export function toGmailQuery(q: ListEmailsQuery): string {
  const parts: string[] = [];
  if (q.text) parts.push(q.text);
  if (q.from) parts.push(`from:${q.from.replace(/\s+/g, "")}`);
  if (q.unreadOnly) parts.push("is:unread");
  if (q.newerThanDays) parts.push(`newer_than:${q.newerThanDays}d`);
  if (q.label) parts.push(`label:${q.label.replace(/\s+/g, "-")}`);
  if (q.inboxOnly) parts.push("in:inbox");
  return parts.join(" ");
}

export class GmailProvider implements EmailProvider {
  readonly name = "Gmail";
  private labelCache?: Map<string, string>;

  constructor(private readonly http: GoogleHttp) {}

  async listEmails(q: ListEmailsQuery): Promise<EmailSummary[]> {
    const list = await this.http.request<{ messages?: Array<{ id: string }> }>(`${BASE}/messages`, {
      query: { q: toGmailQuery(q) || undefined, maxResults: Math.min(q.maxResults ?? 20, 50) },
    });
    const ids = (list.messages ?? []).map((m) => m.id);
    const msgs = await Promise.all(
      ids.map((id) =>
        this.http.request<GmailMessage>(`${BASE}/messages/${encodeURIComponent(id)}`, {
          query: { format: "metadata", metadataHeaders: ["From", "To", "Subject", "Date"] },
        }),
      ),
    );
    return msgs.map(toSummary);
  }

  async readEmail(id: string): Promise<Email> {
    const msg = await this.http.request<GmailMessage>(`${BASE}/messages/${encodeURIComponent(id)}`, { query: { format: "full" } });
    return {
      ...toSummary(msg),
      hasAttachments: attachments(msg).length > 0,
      cc: parseAddressList(header(msg, "Cc")),
      bodyText: extractBody(msg),
      messageIdHeader: header(msg, "Message-ID") ?? header(msg, "Message-Id"),
      references: header(msg, "References"),
      listUnsubscribe: header(msg, "List-Unsubscribe"),
      attachments: attachments(msg),
    };
  }

  private async buildOutgoing(input: OutgoingEmail): Promise<{ raw: string; threadId?: string }> {
    if (!input.replyToMessageId) return { raw: buildRawMessage(input) };
    const orig = await this.readEmail(input.replyToMessageId);
    const refs = [orig.references, orig.messageIdHeader].filter(Boolean).join(" ");
    const subject = /^re:/i.test(input.subject) ? input.subject : input.subject || `Re: ${orig.subject}`;
    return {
      raw: buildRawMessage({ ...input, subject, inReplyTo: orig.messageIdHeader, references: refs || undefined }),
      threadId: orig.threadId,
    };
  }

  async draftEmail(input: OutgoingEmail): Promise<EmailDraft> {
    const { raw, threadId } = await this.buildOutgoing(input);
    const res = await this.http.request<{ id: string; message?: { id: string } }>(`${BASE}/drafts`, {
      method: "POST",
      body: { message: { raw, threadId } },
    });
    return { id: res.id, messageId: res.message?.id };
  }

  async sendEmail(input: OutgoingEmail): Promise<SendResult> {
    const { raw, threadId } = await this.buildOutgoing(input);
    const res = await this.http.request<{ id: string; threadId: string }>(`${BASE}/messages/send`, {
      method: "POST",
      body: { raw, threadId },
      idempotent: false,
    });
    return { id: res.id, threadId: res.threadId };
  }

  async forwardEmail(id: string, to: string[], note?: string): Promise<SendResult> {
    const orig = await this.readEmail(id);
    const body =
      `${note ? `${note}\n\n` : ""}---------- Weitergeleitete Nachricht ----------\n` +
      `Von: ${orig.from.name ? `${orig.from.name} <${orig.from.email}>` : orig.from.email}\n` +
      `Datum: ${orig.date}\nBetreff: ${orig.subject}\n\n${orig.bodyText}`;
    const raw = buildRawMessage({ to, subject: /^fwd?:/i.test(orig.subject) ? orig.subject : `Fwd: ${orig.subject}`, body });
    const res = await this.http.request<{ id: string; threadId: string }>(`${BASE}/messages/send`, {
      method: "POST",
      body: { raw },
      idempotent: false,
    });
    return { id: res.id, threadId: res.threadId };
  }

  private async labelId(name: string, create: boolean): Promise<string | undefined> {
    const system = ["INBOX", "UNREAD", "STARRED", "IMPORTANT", "SPAM", "TRASH", "SENT", "DRAFT"];
    if (system.includes(name.toUpperCase())) return name.toUpperCase();
    if (!this.labelCache) {
      const res = await this.http.request<{ labels?: Array<{ id: string; name: string }> }>(`${BASE}/labels`);
      this.labelCache = new Map((res.labels ?? []).map((l) => [l.name.toLowerCase(), l.id]));
    }
    const existing = this.labelCache.get(name.toLowerCase());
    if (existing || !create) return existing;
    const created = await this.http.request<{ id: string; name: string }>(`${BASE}/labels`, {
      method: "POST",
      body: { name, labelListVisibility: "labelShow", messageListVisibility: "show" },
    });
    this.labelCache.set(created.name.toLowerCase(), created.id);
    return created.id;
  }

  async modifyLabels(id: string, change: { add?: string[]; remove?: string[] }): Promise<void> {
    const addLabelIds = (await Promise.all((change.add ?? []).map((n) => this.labelId(n, true)))).filter(Boolean);
    const removeLabelIds = (await Promise.all((change.remove ?? []).map((n) => this.labelId(n, false)))).filter(Boolean);
    await this.http.request(`${BASE}/messages/${encodeURIComponent(id)}/modify`, {
      method: "POST",
      body: { addLabelIds, removeLabelIds },
      idempotent: true,
    });
  }

  markRead(id: string, read: boolean): Promise<void> {
    return this.modifyLabels(id, read ? { remove: ["UNREAD"] } : { add: ["UNREAD"] });
  }

  archive(id: string): Promise<void> {
    return this.modifyLabels(id, { remove: ["INBOX"] });
  }

  async trash(id: string): Promise<void> {
    await this.http.request(`${BASE}/messages/${encodeURIComponent(id)}/trash`, { method: "POST", idempotent: true });
  }
}
