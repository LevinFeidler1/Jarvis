import { randomBytes } from "node:crypto";

// Prints fresh secrets for .env / Vercel. Nothing is written to disk.
console.log("# In .env bzw. Vercel → Settings → Environment Variables eintragen (niemals committen):");
console.log(`JARVIS_ACCESS_TOKEN=${randomBytes(32).toString("base64url")}`);
console.log(`JARVIS_ENCRYPTION_KEY=${randomBytes(32).toString("base64")}`);
console.log(`CRON_SECRET=${randomBytes(32).toString("base64url")}`);
