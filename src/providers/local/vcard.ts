import type { Contact, ContactInput } from "../types.js";

export const MAX_VCARD_CONTACTS = 5000;

function decodeQuotedPrintable(v: string): string {
  const bytes: number[] = [];
  const s = v.replace(/=\r?\n/g, "");
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "=" && /^[0-9A-F]{2}$/i.test(s.slice(i + 1, i + 3))) {
      bytes.push(parseInt(s.slice(i + 1, i + 3), 16));
      i += 2;
    } else {
      bytes.push(...Buffer.from(s[i]!, "utf8"));
    }
  }
  return Buffer.from(bytes).toString("utf8");
}

const unescape = (v: string) => v.replace(/\\n/gi, "\n").replace(/\\([,;\\])/g, "$1");

/** Splits on `sep` unless it is backslash-escaped. */
function splitEscaped(v: string, sep: string): string[] {
  const out: string[] = [];
  let cur = "";
  for (let i = 0; i < v.length; i++) {
    if (v[i] === "\\" && i + 1 < v.length) {
      cur += v[i]! + v[i + 1]!;
      i++;
    } else if (v[i] === sep) {
      out.push(cur);
      cur = "";
    } else cur += v[i];
  }
  out.push(cur);
  return out;
}

/**
 * Minimal vCard 2.1/3.0/4.0 reader (exports from iPhone, Android, Outlook,
 * Google, 1&1/IONOS). Reads FN/N, EMAIL, TEL, ORG, TITLE, NOTE.
 */
export function parseVCards(text: string): ContactInput[] {
  // Unfold continuation lines (RFC 6350 §3.2) and quoted-printable soft breaks.
  const lines = text
    .replace(/\r\n/g, "\n")
    .replace(/=\n(?=[^\n])/g, "=\uE000")
    .replace(/\n[ \t]/g, "")
    .split("\n");
  const result: ContactInput[] = [];
  let cur: { fn?: string; n?: string; emails: string[]; phones: string[]; org?: string; title?: string; note?: string } | null = null;

  for (let raw of lines) {
    raw = raw.replace(/=\uE000/g, "=\n");
    const colon = raw.indexOf(":");
    if (colon < 0) continue;
    const head = raw.slice(0, colon);
    let value = raw.slice(colon + 1);
    const [nameWithGroup, ...params] = head.split(";");
    const prop = nameWithGroup!.split(".").pop()!.toUpperCase();
    const paramStr = params.join(";").toUpperCase();

    if (prop === "BEGIN" && value.trim().toUpperCase() === "VCARD") {
      cur = { emails: [], phones: [] };
      continue;
    }
    if (!cur) continue;
    if (prop === "END" && value.trim().toUpperCase() === "VCARD") {
      const n = cur.n ? splitEscaped(cur.n, ";").map(unescape) : [];
      const fromN = [n[3], n[1], n[2], n[0], n[4]].filter((p) => p && p.trim()).join(" ").trim();
      const name = (cur.fn && unescape(cur.fn).trim()) || fromN || cur.emails[0] || cur.org || "";
      if (name) {
        result.push({
          name: name.slice(0, 200),
          emails: cur.emails.slice(0, 10),
          phones: cur.phones.slice(0, 10),
          organization: cur.org?.slice(0, 200),
          role: cur.title?.slice(0, 200),
          notes: cur.note?.slice(0, 2000),
        });
        if (result.length >= MAX_VCARD_CONTACTS) break;
      }
      cur = null;
      continue;
    }

    if (paramStr.includes("QUOTED-PRINTABLE")) value = decodeQuotedPrintable(value);
    value = value.trim();
    if (!value) continue;
    switch (prop) {
      case "FN":
        cur.fn = value;
        break;
      case "N":
        cur.n = value;
        break;
      case "EMAIL": {
        const e = unescape(value).replace(/^mailto:/i, "").trim();
        if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) cur.emails.push(e);
        break;
      }
      case "TEL":
        cur.phones.push(unescape(value).replace(/^tel:/i, "").trim());
        break;
      case "ORG":
        cur.org = splitEscaped(value, ";").map(unescape).filter((p) => p.trim()).join(", ");
        break;
      case "TITLE":
        cur.title = unescape(value);
        break;
      case "NOTE":
        cur.note = unescape(value);
        break;
    }
  }
  return result;
}

const esc = (v: string) => v.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/([,;])/g, "\\$1");

/** vCard 3.0 export (for backups or import into phone/Google). */
export function toVCards(contacts: Contact[]): string {
  return contacts
    .map((c) =>
      [
        "BEGIN:VCARD",
        "VERSION:3.0",
        `FN:${esc(c.name)}`,
        `N:${esc(c.name.split(" ").slice(1).join(" "))};${esc(c.name.split(" ")[0] ?? "")};;;`,
        ...c.emails.map((e) => `EMAIL;TYPE=INTERNET:${esc(e)}`),
        ...c.phones.map((p) => `TEL:${esc(p)}`),
        ...(c.organization ? [`ORG:${esc(c.organization)}`] : []),
        ...(c.role ? [`TITLE:${esc(c.role)}`] : []),
        ...(c.notes ? [`NOTE:${esc(c.notes)}`] : []),
        "END:VCARD",
      ].join("\r\n"),
    )
    .join("\r\n");
}
