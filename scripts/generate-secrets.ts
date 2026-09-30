import { randomBytes } from "node:crypto";

// Prints fresh secrets for .env. Nothing is written to disk.
console.log("# In .env eintragen (niemals committen):");
console.log(`JARVIS_ACCESS_TOKEN=${randomBytes(32).toString("base64url")}`);
console.log(`JARVIS_ENCRYPTION_KEY=${randomBytes(32).toString("base64")}`);
