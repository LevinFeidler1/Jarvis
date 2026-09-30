import { z } from "zod";

const optionalString = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() !== "" ? v.trim() : undefined));

const EnvSchema = z.object({
  ANTHROPIC_API_KEY: optionalString,
  ANTHROPIC_MODEL: optionalString.transform((v) => v ?? "claude-opus-5-5"),
  JARVIS_ACCESS_TOKEN: z
    .string({ error: "JARVIS_ACCESS_TOKEN fehlt (npm run setup:secrets)" })
    .min(32, "JARVIS_ACCESS_TOKEN muss mindestens 32 Zeichen lang sein"),
  JARVIS_ENCRYPTION_KEY: z
    .string({ error: "JARVIS_ENCRYPTION_KEY fehlt (npm run setup:secrets)" })
    .refine((v) => Buffer.from(v, "base64").length === 32, {
      message: "JARVIS_ENCRYPTION_KEY muss 32 Byte (Base64) lang sein",
    }),
  JARVIS_HOST: z.string().default("127.0.0.1"),
  JARVIS_PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  JARVIS_PUBLIC_URL: z.url().default("http://localhost:3000"),
  JARVIS_DB_PATH: z.string().default("./data/jarvis.db"),
  JARVIS_TIMEZONE: z.string().default("Europe/Berlin"),
  JARVIS_LANGUAGE: z.string().default("de"),
  JARVIS_USER_NAME: optionalString,
  JARVIS_MAX_AGENT_STEPS: z.coerce.number().int().min(1).max(50).default(12),
  JARVIS_CONFIRMATION_TTL_MINUTES: z.coerce.number().int().min(1).max(1440).default(30),
  GOOGLE_CLIENT_ID: optionalString,
  GOOGLE_CLIENT_SECRET: optionalString,
});

export interface AppConfig {
  anthropicApiKey?: string;
  model: string;
  accessToken: string;
  encryptionKey: Buffer;
  host: string;
  port: number;
  publicUrl: string;
  dbPath: string;
  timezone: string;
  language: string;
  userName?: string;
  maxAgentSteps: number;
  confirmationTtlMinutes: number;
  google?: { clientId: string; clientSecret: string };
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Ungültige Konfiguration:\n${issues}\nSiehe .env.example`);
  }
  const e = parsed.data;
  try {
    new Intl.DateTimeFormat("de-DE", { timeZone: e.JARVIS_TIMEZONE });
  } catch {
    throw new Error(`Ungültige Zeitzone JARVIS_TIMEZONE=${e.JARVIS_TIMEZONE}`);
  }
  return {
    anthropicApiKey: e.ANTHROPIC_API_KEY,
    model: e.ANTHROPIC_MODEL,
    accessToken: e.JARVIS_ACCESS_TOKEN,
    encryptionKey: Buffer.from(e.JARVIS_ENCRYPTION_KEY, "base64"),
    host: e.JARVIS_HOST,
    port: e.JARVIS_PORT,
    publicUrl: e.JARVIS_PUBLIC_URL.replace(/\/$/, ""),
    dbPath: e.JARVIS_DB_PATH,
    timezone: e.JARVIS_TIMEZONE,
    language: e.JARVIS_LANGUAGE,
    userName: e.JARVIS_USER_NAME,
    maxAgentSteps: e.JARVIS_MAX_AGENT_STEPS,
    confirmationTtlMinutes: e.JARVIS_CONFIRMATION_TTL_MINUTES,
    google:
      e.GOOGLE_CLIENT_ID && e.GOOGLE_CLIENT_SECRET
        ? { clientId: e.GOOGLE_CLIENT_ID, clientSecret: e.GOOGLE_CLIENT_SECRET }
        : undefined,
  };
}
