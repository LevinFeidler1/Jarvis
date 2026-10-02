// Browser agent on your own computer (alternative to the Vercel function):
//   JARVIS_ENCRYPTION_KEY=<same as on Vercel> JARVIS_CHROMIUM_PATH=/path/to/chrome npm run browser-worker
// Expose it with a free tunnel (e.g. `cloudflared tunnel --url http://localhost:3210`) and set
// JARVIS_BROWSER_URL=https://<tunnel>/run on Vercel. Same protocol and secret as api/browser.ts.
import http from "node:http";
import { PlaywrightEngine } from "../src/browser/engine.js";
import { checkBrowserSecret } from "../src/browser/remote.js";

const key = process.env.JARVIS_ENCRYPTION_KEY;
const chromium = process.env.JARVIS_CHROMIUM_PATH;
if (!key || !chromium) {
  console.error("JARVIS_ENCRYPTION_KEY und JARVIS_CHROMIUM_PATH setzen.");
  process.exit(1);
}
const engine = new PlaywrightEngine({ executablePath: chromium, maxDownloadBytes: 3 * 1024 * 1024 });
const port = Number(process.env.PORT ?? 3210);

http
  .createServer(async (req, res) => {
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (req.method !== "POST" || !req.url?.startsWith("/run")) return send(404, { error: "POST /run" });
    if (!checkBrowserSecret(req.headers.authorization, Buffer.from(key, "base64"))) return send(401, { error: "Unauthorized" });
    let raw = "";
    for await (const c of req) {
      raw += c;
      if (raw.length > 256 * 1024) return send(413, { error: "zu groß" });
    }
    try {
      send(200, await engine.run(JSON.parse(raw)));
    } catch (err) {
      send(400, { error: (err as Error).message });
    }
  })
  .listen(port, "127.0.0.1", () => console.log(`JARVIS-Browser-Worker auf http://127.0.0.1:${port}/run`));
