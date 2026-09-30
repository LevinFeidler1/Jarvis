import type { EmailAddress } from "../types.js";

/** Rejects header injection (CR/LF) in any header value. */
function headerSafe(value: string): string {
  if (/[\r\n]/.test(value)) throw new Error("Ungültiger Header-Wert (Zeilenumbruch)");
  return value;
}

function encodeHeaderWord(value: string): string {
  // eslint-disable-next-line no-control-regex
  return /^[\x20-\x7E]*$/.test(value) ? value : `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

export interface MimeInput {
  from?: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  body: string;
  inReplyTo?: string;
  references?: string;
}

/** Builds an RFC 5322 text/plain message, base64url-encoded for the Gmail API. */
export function buildRawMessage(m: MimeInput): string {
  const lines: string[] = [];
  if (m.from) lines.push(`From: ${headerSafe(m.from)}`);
  lines.push(`To: ${m.to.map(headerSafe).join(", ")}`);
  if (m.cc?.length) lines.push(`Cc: ${m.cc.map(headerSafe).join(", ")}`);
  if (m.bcc?.length) lines.push(`Bcc: ${m.bcc.map(headerSafe).join(", ")}`);
  lines.push(`Subject: ${encodeHeaderWord(headerSafe(m.subject))}`);
  if (m.inReplyTo) lines.push(`In-Reply-To: ${headerSafe(m.inReplyTo)}`);
  if (m.references) lines.push(`References: ${headerSafe(m.references)}`);
  lines.push("MIME-Version: 1.0");
  lines.push('Content-Type: text/plain; charset="UTF-8"');
  lines.push("Content-Transfer-Encoding: base64");
  const body = Buffer.from(m.body.replace(/\r?\n/g, "\r\n"), "utf8")
    .toString("base64")
    .replace(/(.{76})/g, "$1\r\n");
  return Buffer.from(`${lines.join("\r\n")}\r\n\r\n${body}`, "utf8").toString("base64url");
}

export function parseAddress(raw: string): EmailAddress {
  const m = raw.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  if (m) return { name: m[1]?.trim() || undefined, email: m[2]!.trim() };
  return { email: raw.trim() };
}

export function parseAddressList(raw: string | undefined): EmailAddress[] {
  if (!raw) return [];
  // Split on commas that are not inside quotes.
  return raw
    .split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map(parseAddress);
}

export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h\d)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
