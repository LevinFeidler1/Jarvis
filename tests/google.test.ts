import { randomBytes } from "node:crypto";
import { testDb } from "./helpers.js";
import { describe, expect, it } from "vitest";
import { GmailProvider, toGmailQuery } from "../src/providers/google/gmail.js";
import { GoogleHttp } from "../src/providers/google/http.js";
import { buildRawMessage } from "../src/providers/google/mime.js";
import { GOOGLE_SCOPES, GoogleAuth } from "../src/providers/google/oauth.js";
import { TokenStore } from "../src/security/token-store.js";

interface Call {
  url: string;
  method: string;
  body?: unknown;
}

function parseBody(body: unknown): unknown {
  if (!body) return undefined;
  try {
    return JSON.parse(String(body));
  } catch {
    return String(body);
  }
}

async function setup(responder: (call: Call) => Response) {
  const db = await testDb();
  const tokens = new TokenStore(db, randomBytes(32));
  await tokens.save("google", { accessToken: "at", refreshToken: "rt", expiresAt: Date.now() + 3_600_000 }, GOOGLE_SCOPES);
  const calls: Call[] = [];
  const fetchImpl = (async (input: string | URL, init?: RequestInit) => {
    const call = { url: String(input), method: init?.method ?? "GET", body: parseBody(init?.body) };
    calls.push(call);
    return responder(call);
  }) as typeof fetch;
  const auth = new GoogleAuth({ clientId: "id", clientSecret: "secret", redirectUri: "http://localhost/cb" }, tokens, db, fetchImpl);
  const http = new GoogleHttp(auth, fetchImpl, async () => {});
  return { calls, gmail: new GmailProvider(http), auth, db };
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const decodeRaw = (raw: string) => Buffer.from(raw, "base64url").toString("utf8");

describe("Gmail provider", () => {
  it("builds provider search queries", () => {
    expect(toGmailQuery({ text: "Rechnung", unreadOnly: true, newerThanDays: 3, inboxOnly: true })).toBe("Rechnung is:unread newer_than:3d in:inbox");
  });

  it("sends a plain email with UTF-8 subject", async () => {
    const { calls, gmail } = await setup(() => json({ id: "s1", threadId: "t1" }));
    await gmail.sendEmail({ to: ["anna@example.com"], subject: "Grüße", body: "Donnerstag passt." });
    expect(calls[0]!.url).toContain("/messages/send");
    const raw = decodeRaw((calls[0]!.body as { raw: string }).raw);
    expect(raw).toContain("To: anna@example.com");
    expect(raw).toContain("Subject: =?UTF-8?B?");
    expect(Buffer.from(raw.split("\r\n\r\n")[1]!.replace(/\r\n/g, ""), "base64").toString()).toBe("Donnerstag passt.");
  });

  it("replies in-thread with In-Reply-To/References", async () => {
    const { calls, gmail } = await setup((c) =>
      c.method === "GET"
        ? json({
            id: "m1",
            threadId: "t9",
            payload: { headers: [{ name: "Subject", value: "Termin" }, { name: "Message-ID", value: "<abc@mail>" }, { name: "From", value: "Anna <anna@example.com>" }] },
          })
        : json({ id: "s1", threadId: "t9" }),
    );
    await gmail.sendEmail({ to: ["anna@example.com"], subject: "", body: "Passt.", replyToMessageId: "m1" });
    const send = calls.find((c) => c.method === "POST")!;
    expect((send.body as { threadId: string }).threadId).toBe("t9");
    const raw = decodeRaw((send.body as { raw: string }).raw);
    expect(raw).toContain("In-Reply-To: <abc@mail>");
    expect(raw).toContain("Subject: Re: Termin");
  });

  it("rejects header injection", () => {
    expect(() => buildRawMessage({ to: ["a@b.de\r\nBcc: x@y.de"], subject: "x", body: "y" })).toThrow();
  });

  it("retries idempotent reads on 503 but never retries sending", async () => {
    let n = 0;
    const read = await setup(() => (++n < 3 ? json({ error: "busy" }, 503) : json({ messages: [] })));
    await expect(read.gmail.listEmails({})).resolves.toEqual([]);
    expect(read.calls).toHaveLength(3);

    const send = await setup(() => json({ error: { message: "busy" } }, 503));
    await expect(send.gmail.sendEmail({ to: ["a@b.de"], subject: "x", body: "y" })).rejects.toMatchObject({ code: "UPSTREAM_ERROR" });
    expect(send.calls).toHaveLength(1);
  });

  it("maps 429 to RATE_LIMITED after retries", async () => {
    const { gmail } = await setup(() => json({}, 429));
    await expect(gmail.listEmails({})).rejects.toMatchObject({ code: "RATE_LIMITED" });
  });

  it("extracts plain text from multipart messages and detects newsletters", async () => {
    const b64 = (s: string) => Buffer.from(s).toString("base64url");
    const { gmail } = await setup(() =>
      json({
        id: "m1",
        threadId: "t1",
        labelIds: ["INBOX"],
        payload: {
          headers: [{ name: "From", value: '"Shop, Inc" <news@shop.example>' }, { name: "List-Unsubscribe", value: "<mailto:u@shop.example>" }],
          parts: [
            { mimeType: "text/html", body: { data: b64("<p>Hallo <b>Welt</b></p>") } },
            { mimeType: "application/pdf", filename: "rechnung.pdf", body: { attachmentId: "a1", size: 1000 } },
          ],
        },
      }),
    );
    const m = await gmail.readEmail("m1");
    expect(m.bodyText).toBe("Hallo Welt");
    expect(m.from).toEqual({ name: "Shop, Inc", email: "news@shop.example" });
    expect(m.listUnsubscribe).toBeTruthy();
    expect(m.attachments).toEqual([{ filename: "rechnung.pdf", mimeType: "application/pdf", size: 1000 }]);
  });
});

describe("Google OAuth", () => {
  it("builds a least-privilege consent URL with state and PKCE", async () => {
    const { auth } = await setup(() => json({}));
    const url = new URL(await auth.createAuthUrl());
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("state")).toBeTruthy();
    expect(url.searchParams.get("access_type")).toBe("offline");
    const scopes = url.searchParams.get("scope")!.split(" ");
    expect(scopes).not.toContain("https://mail.google.com/"); // full mailbox incl. permanent delete
    expect(scopes).not.toContain("https://www.googleapis.com/auth/calendar");
  });

  it("rejects callbacks with unknown state", async () => {
    const { auth } = await setup(() => json({}));
    await expect(auth.handleCallback("code", "forged")).rejects.toThrow(/State/);
  });

  it("refreshes expired tokens and handles revoked access", async () => {
    const { auth, calls } = await setup(() => json({ access_token: "new", expires_in: 3600 }));
    // Force expiry
    const store = (auth as unknown as { tokens: TokenStore }).tokens;
    await store.save("google", { accessToken: "old", refreshToken: "rt", expiresAt: 0 }, GOOGLE_SCOPES);
    expect(await auth.getAccessToken()).toBe("new");
    expect(calls[0]!.url).toContain("oauth2.googleapis.com/token");

    const revoked = await setup(() => json({ error: "invalid_grant" }, 400));
    await (revoked.auth as unknown as { tokens: TokenStore }).tokens.save("google", { accessToken: "old", refreshToken: "rt", expiresAt: 0 }, []);
    await expect(revoked.auth.getAccessToken()).rejects.toMatchObject({ code: "AUTH_FAILED" });
  });
});
