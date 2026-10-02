import type { IncomingMessage, ServerResponse } from "node:http";
import { handleVercelRequest } from "../src/vercel/handler.js";

/**
 * Vercel Function for the long-running routes only: chat/agent (streaming),
 * confirmations, cron, Telegram, automation runs (maxDuration 300 s). Each
 * route still stops cleanly at 270 s (REQUEST_TIMEOUTS.agent in src/server.ts).
 */
export default function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  return handleVercelRequest(req, res);
}
