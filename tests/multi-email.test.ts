import { describe, expect, it } from "vitest";
import { RiskLevel } from "../src/core/types.js";
import { MultiAccountEmail, accountOfId } from "../src/providers/multi-email.js";
import { FakeEmail, harness, makeEmail, message, text, toolUse } from "./helpers.js";

function setup(defaultAccount: string | null = null) {
  const gmail = new FakeEmail([makeEmail({ id: "g1", subject: "Privat", date: "2026-09-30T09:00:00.000Z", from: { email: "mama@example.com" } })]);
  const ionos = new FakeEmail([makeEmail({ id: "i1", subject: "Rechnung", date: "2026-09-30T10:00:00.000Z", from: { email: "kunde@firma.de" } })]);
  const allinkl = new FakeEmail([makeEmail({ id: "a1", subject: "Angebot", date: "2026-09-30T08:00:00.000Z", from: { email: "lead@kmu.de" } })]);
  const multi = new MultiAccountEmail(
    [
      { email: "lev.feidler@gmail.com", name: "Gmail", kind: "gmail", provider: gmail },
      { email: "levin@feidler.de", name: "Privat 1&1", kind: "imap", provider: ionos },
      { email: "levin.feidler@fa-automations.de", name: "F&A", kind: "imap", provider: allinkl },
    ],
    defaultAccount,
  );
  return { multi, gmail, ionos, allinkl };
}

describe("MultiAccountEmail", () => {
  it("merges all mailboxes newest first and tags each mail with its account", async () => {
    const { multi } = setup();
    const { emails, failures } = await multi.listAcrossAccounts({});
    expect(emails.map((e) => e.subject)).toEqual(["Rechnung", "Privat", "Angebot"]);
    expect(emails[0]).toMatchObject({ id: "levin@feidler.de|i1", account: "levin@feidler.de" });
    expect(failures).toEqual([]);
  });

  it("filters by account", async () => {
    const { multi } = setup();
    const { emails } = await multi.listAcrossAccounts({ account: "levin.feidler@fa-automations.de" });
    expect(emails.map((e) => e.subject)).toEqual(["Angebot"]);
  });

  it("reports unreachable mailboxes instead of hiding them", async () => {
    const { multi, ionos } = setup();
    ionos.listEmails = async () => {
      throw new Error("Anmeldung fehlgeschlagen");
    };
    const { emails, failures } = await multi.listAcrossAccounts({});
    expect(emails).toHaveLength(2);
    expect(failures).toEqual([{ account: "levin@feidler.de", error: "Anmeldung fehlgeschlagen" }]);
  });

  it("replies always go out from the original mailbox", async () => {
    const { multi, ionos, gmail } = setup("lev.feidler@gmail.com");
    await multi.sendEmail({ to: ["kunde@firma.de"], subject: "", body: "Danke", replyToMessageId: "levin@feidler.de|i1" });
    expect(ionos.sent).toEqual([expect.objectContaining({ replyToMessageId: "i1", fromAccount: undefined })]);
    expect(gmail.sent).toHaveLength(0);
    await expect(
      multi.sendEmail({ to: ["x@y.de"], subject: "", body: "x", replyToMessageId: "levin@feidler.de|i1", fromAccount: "lev.feidler@gmail.com" }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("never guesses the sender for new mail when ambiguous", async () => {
    const { multi } = setup(null);
    await expect(multi.sendEmail({ to: ["x@y.de"], subject: "Hi", body: "x" })).rejects.toMatchObject({ code: "AMBIGUOUS" });
  });

  it("uses the explicit or default sending account", async () => {
    const { multi, allinkl, gmail } = setup("lev.feidler@gmail.com");
    await multi.sendEmail({ to: ["x@y.de"], subject: "Angebot", body: "x", fromAccount: "levin.feidler@fa-automations.de" });
    expect(allinkl.sent).toHaveLength(1);
    await multi.sendEmail({ to: ["x@y.de"], subject: "Hi", body: "x" });
    expect(gmail.sent).toHaveLength(1);
  });

  it("routes organising actions to the right mailbox and rejects unknown ids", async () => {
    const { multi, allinkl } = setup();
    await multi.markRead("levin.feidler@fa-automations.de|a1", true);
    expect(allinkl.read.has("a1")).toBe(true);
    await expect(multi.markRead("a1", true)).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(multi.markRead("fremd@evil.de|a1", true)).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(accountOfId("levin@feidler.de|INBOX.5")).toBe("levin@feidler.de");
  });
});

describe("agent with several mailboxes", () => {
  it("shows the sending mailbox in the confirmation", async () => {
    const { multi } = setup();
    const h = await harness([
      message([toolUse("send_email", { from_account: "levin.feidler@fa-automations.de", to: ["lead@kmu.de"], subject: "Angebot", body: "Anbei das Angebot." })]),
      message([text("Soll ich das Angebot von deiner F&A-Adresse senden?")]),
    ]);
    h.providers.setProviders({ email: multi });
    const r = await h.agent.handleUserMessage(undefined, "Schick Lead das Angebot von F&A.");
    expect(r.pendingActions[0]!.risk).toBe(RiskLevel.EXTERNAL);
    expect(r.pendingActions[0]!.description).toContain("Von: levin.feidler@fa-automations.de");
  });

  it("asks back before any confirmation when the mailbox is ambiguous", async () => {
    const { multi } = setup(null);
    const h = await harness([
      message([toolUse("send_email", { to: ["x@y.de"], subject: "Hi", body: "Hallo" })]),
      (req) => {
        const r = JSON.parse((req.messages.at(-1)!.content as Array<{ content: string }>)[0]!.content);
        expect(r).toMatchObject({ ok: false, status: "not_prepared", code: "AMBIGUOUS" });
        return message([text("Von welchem Postfach soll ich senden: Gmail, 1&1 oder F&A?")]);
      },
    ]);
    h.providers.setProviders({ email: multi });
    const r = await h.agent.handleUserMessage(undefined, "Schreib x Hallo");
    expect(r.pendingActions).toHaveLength(0);
    expect(r.text).toContain("Von welchem Postfach");
  });
});
