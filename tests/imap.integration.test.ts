/**
 * Runs the IMAP/SMTP provider against a real IMAP server (e.g. Dovecot) and an
 * in-process SMTP server. Skipped unless IMAP_TEST_HOST is set:
 *   IMAP_TEST_HOST=127.0.0.1 IMAP_TEST_PORT=1143 IMAP_TEST_USER=… IMAP_TEST_PASS=… npm test
 */
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import nodemailer from "nodemailer";
import { SMTPServer } from "smtp-server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { EmailAccountWithSecret } from "../src/providers/imap/accounts.js";
import { ImapEmailProvider, decodeId } from "../src/providers/imap/imap.js";

const HOST = process.env.IMAP_TEST_HOST;
const run = HOST ? describe : describe.skip;

run("ImapEmailProvider (real IMAP server)", () => {
  const marker = randomUUID().slice(0, 8);
  const received: Array<{ from: string; to: string[]; raw: string }> = [];
  let smtp: SMTPServer;
  let smtpPort = 0;
  let acct: EmailAccountWithSecret;
  let provider: ImapEmailProvider;

  const raw = (subject: string, body: string, from = "Anna Müller <anna@example.com>") =>
    [`From: ${from}`, `To: ${process.env.IMAP_TEST_USER}`, `Subject: ${subject}`, `Message-ID: <${randomUUID()}@example.com>`, `Date: ${new Date().toUTCString()}`, "Content-Type: text/plain; charset=utf-8", "", body].join("\r\n");

  async function direct<T>(fn: (c: ImapFlow) => Promise<T>): Promise<T> {
    const c = new ImapFlow({ host: HOST!, port: Number(process.env.IMAP_TEST_PORT ?? 143), secure: false, auth: { user: process.env.IMAP_TEST_USER!, pass: process.env.IMAP_TEST_PASS! }, logger: false });
    await c.connect();
    try {
      return await fn(c);
    } finally {
      await c.logout();
    }
  }

  beforeAll(async () => {
    smtp = new SMTPServer({
      authOptional: true,
      disabledCommands: ["STARTTLS"],
      onAuth: (_a, _s, cb) => cb(null, { user: "ok" }),
      onData(stream, session, cb) {
        const chunks: Buffer[] = [];
        stream.on("data", (c: Buffer) => chunks.push(c));
        stream.on("end", () => {
          received.push({ from: session.envelope.mailFrom ? session.envelope.mailFrom.address : "", to: session.envelope.rcptTo.map((r) => r.address), raw: Buffer.concat(chunks).toString() });
          cb();
        });
      },
    });
    await new Promise<void>((r) => smtp.listen(0, "127.0.0.1", () => r()));
    smtpPort = (smtp.server.address() as AddressInfo).port;
    acct = {
      id: "t",
      email: process.env.IMAP_TEST_USER!,
      name: "Levin Feidler",
      preset: "custom",
      username: process.env.IMAP_TEST_USER!,
      password: process.env.IMAP_TEST_PASS!,
      imap: { host: HOST!, port: Number(process.env.IMAP_TEST_PORT ?? 143), secure: false },
      smtp: { host: "127.0.0.1", port: smtpPort, secure: false },
      createdAt: "",
    };
    // Test transport: same message path, but no STARTTLS on the local test server.
    provider = new ImapEmailProvider(acct, {
      createTransport: () => nodemailer.createTransport({ host: "127.0.0.1", port: smtpPort, secure: false, ignoreTLS: true }),
    });
    await direct(async (c) => {
      await c.append("INBOX", raw(`Donnerstag 14 Uhr? ${marker}`, "Hallo Levin,\n\npasst dir Donnerstag um 14 Uhr?\n\nAnna"));
      await c.append("INBOX", raw(`Ihre Rechnung ${marker}`, "Rechnungsbetrag 84,20 EUR", "Stadtwerke <rechnung@stadtwerke.example>"));
    });
  });

  afterAll(async () => {
    await new Promise<void>((r) => smtp?.close(() => r()));
  });

  it("verifies credentials and rejects a wrong password", async () => {
    await expect(new ImapEmailProvider(acct, { createTransport: () => ({ verify: async () => true, sendMail: async () => ({}) }) as never }).verify()).resolves.toBeUndefined();
    await expect(new ImapEmailProvider({ ...acct, password: "falsch" }).verify()).rejects.toMatchObject({ code: "AUTH_FAILED" });
  });

  it("lists unread mail with sender, subject and snippet", async () => {
    const mails = await provider.listEmails({ text: marker, unreadOnly: true });
    const anna = mails.find((m) => m.subject.startsWith("Donnerstag"))!;
    expect(anna).toMatchObject({ from: { name: "Anna Müller", email: "anna@example.com" }, unread: true, labels: ["INBOX"] });
    expect(anna.snippet).toContain("passt dir Donnerstag");
    expect(mails).toHaveLength(2);
  });

  it("reads a mail without marking it read, then marks it read", async () => {
    const [m] = await provider.listEmails({ text: `Donnerstag 14 Uhr? ${marker}` });
    const full = await provider.readEmail(m!.id);
    expect(full.bodyText).toContain("Donnerstag um 14 Uhr");
    expect(full.messageIdHeader).toMatch(/@example\.com>$/);
    expect((await provider.listEmails({ text: `Donnerstag 14 Uhr? ${marker}`, unreadOnly: true })).length).toBe(1);
    await provider.markRead(m!.id, true);
    expect((await provider.listEmails({ text: `Donnerstag 14 Uhr? ${marker}`, unreadOnly: true })).length).toBe(0);
  });

  it("replies in-thread via SMTP and files a copy in Sent", async () => {
    const [m] = await provider.listEmails({ text: `Donnerstag 14 Uhr? ${marker}` });
    const orig = await provider.readEmail(m!.id);
    await provider.sendEmail({ to: ["anna@example.com"], subject: "", body: `Donnerstag um 14 Uhr passt. ${marker}`, replyToMessageId: m!.id });
    const sent = received.at(-1)!;
    expect(sent.from).toBe(acct.email);
    expect(sent.to).toEqual(["anna@example.com"]);
    const parsed = await simpleParser(sent.raw);
    expect(parsed.subject).toBe(`Re: Donnerstag 14 Uhr? ${marker}`);
    expect(parsed.inReplyTo).toBe(orig.messageIdHeader);
    expect(parsed.from?.text).toContain("Levin Feidler");
    const copies = await direct(async (c) => {
      const lock = await c.getMailboxLock("Sent");
      try {
        return (await c.search({ body: marker }, { uid: true })) || [];
      } finally {
        lock.release();
      }
    });
    expect(copies.length).toBeGreaterThanOrEqual(1);
  });

  it("does not put Bcc recipients into the message headers", async () => {
    await provider.sendEmail({ to: ["a@example.com"], bcc: ["geheim@example.com"], subject: `Bcc ${marker}`, body: "x" });
    const sent = received.at(-1)!;
    expect(sent.to).toContain("geheim@example.com");
    expect(sent.raw).not.toContain("geheim@example.com");
  });

  it("saves drafts into the Drafts folder", async () => {
    const d = await provider.draftEmail({ to: ["anna@example.com"], subject: `Entwurf ${marker}`, body: "Noch nicht senden" });
    expect(decodeId(d.id).folder).toBe("Drafts");
  });

  it("sorts into folders (label), archives and trashes", async () => {
    const [bill] = await provider.listEmails({ text: `Ihre Rechnung ${marker}` });
    await provider.modifyLabels(bill!.id, { add: [`Rechnungen-${marker}`] });
    const moved = await provider.listEmails({ label: `Rechnungen-${marker}` });
    expect(moved.map((m) => m.subject)).toEqual([`Ihre Rechnung ${marker}`]);

    await provider.archive(moved[0]!.id);
    const archived = await provider.listEmails({ label: "Archiv", text: marker });
    expect(archived).toHaveLength(1);

    await provider.trash(archived[0]!.id);
    expect(await provider.listEmails({ label: "Archiv", text: marker })).toHaveLength(0);
    expect(await provider.listEmails({ label: "Trash", text: marker })).toHaveLength(1);
  });

  it("maps unknown ids to NOT_FOUND", async () => {
    await expect(provider.readEmail("SU5CT1g.999999")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
