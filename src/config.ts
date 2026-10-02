import { z } from "zod";

const optionalString = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() !== "" ? v.trim() : undefined));

const EnvSchema = z.object({
  ANTHROPIC_API_KEY: optionalString,
  ANTHROPIC_MODEL: optionalString.transform((v) => v ?? "claude-opus-5-5"),
  /** Needed for user-scoped keys (sk-ant-usr-…) that are not bound to a workspace. */
  ANTHROPIC_WORKSPACE_ID: optionalString,
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
  DATABASE_URL: optionalString,
  JARVIS_DB_PATH: z.string().default("./data/pglite"),
  CRON_SECRET: optionalString,
  JARVIS_TIMEZONE: z.string().default("Europe/Berlin"),
  JARVIS_LANGUAGE: z.string().default("de"),
  JARVIS_USER_NAME: optionalString,
  JARVIS_MAX_AGENT_STEPS: z.coerce.number().int().min(1).max(50).default(12),
  JARVIS_COMPACT_AT_TOKENS: z.coerce.number().int().min(50_000).max(900_000).default(60_000),
  JARVIS_TRIAGE_MODEL: optionalString.transform((v) => v ?? "claude-haiku-4-5"),
  JARVIS_TRIAGE_DAILY_LIMIT: z.coerce.number().int().min(0).max(2000).default(150),
  JARVIS_BROWSER: z.enum(["auto", "off", "local", "remote"]).default("auto"),
  JARVIS_BROWSER_URL: optionalString,
  JARVIS_CHROMIUM_PATH: optionalString,
  JARVIS_BROWSER_MAX_STEPS: z.coerce.number().int().min(3).max(100).default(25),
  JARVIS_BROWSER_TASK_MINUTES: z.coerce.number().int().min(1).max(60).default(15),
  JARVIS_MAX_FILE_MB: z.coerce.number().int().min(1).max(50).default(20),
  JARVIS_DB_FILE_QUOTA_MB: z.coerce.number().int().min(10).max(400).default(150),
  JARVIS_CONFIRMATION_TTL_MINUTES: z.coerce.number().int().min(1).max(1440).default(30),
  JARVIS_DRIVE_READ_ALL: z.enum(["true", "false"]).optional().transform((v) => v === "true"),
  GOOGLE_CLIENT_ID: optionalString,
  GOOGLE_CLIENT_SECRET: optionalString,
  TELEGRAM_BOT_TOKEN: optionalString.refine((v) => !v || /^\d+:[\w-]{30,}$/.test(v), { message: "TELEGRAM_BOT_TOKEN hat nicht das Format 123456:ABC… (von @BotFather)" }),
  TELEGRAM_CHAT_ID: optionalString.refine((v) => !v || /^-?\d{1,20}$/.test(v), { message: "TELEGRAM_CHAT_ID muss eine Zahl sein" }),
  TRANSCRIBE_API_KEY: optionalString,
  TRANSCRIBE_API_URL: optionalString.transform((v) => v ?? "https://api.groq.com/openai/v1/audio/transcriptions"),
  TRANSCRIBE_MODEL: optionalString.transform((v) => v ?? "whisper-large-v3-turbo"),
  ELEVENLABS_API_KEY: optionalString,
  ELEVENLABS_VOICE_ID: optionalString.transform((v) => v ?? "JBFqnCBsd6RMkjVDRZzb"),
  ELEVENLABS_MODEL: optionalString.transform((v) => v ?? "eleven_flash_v2_5"),
});

export interface AppConfig {
  anthropicApiKey?: string;
  anthropicWorkspaceId?: string;
  model: string;
  accessToken: string;
  encryptionKey: Buffer;
  host: string;
  port: number;
  publicUrl: string;
  /** Postgres connection string (Neon). If unset, local PGlite is used. */
  databaseUrl?: string;
  /** PGlite data directory for local development. */
  dbPath: string;
  /** Protects the cron endpoint (Vercel sends it as Bearer token). */
  cronSecret?: string;
  timezone: string;
  language: string;
  userName?: string;
  maxAgentSteps: number;
  confirmationTtlMinutes: number;
  /** Conversations longer than this (input tokens) are summarized server-side. */
  compactAtTokens: number;
  files: { maxBytes: number; dbQuotaBytes: number };
  /** Browser agent (Phase E). mode auto: Vercel → own /api/browser function; local → JARVIS_CHROMIUM_PATH. */
  browser: { mode: "auto" | "off" | "local" | "remote"; url?: string; chromiumPath?: string; maxSteps: number; taskMinutes: number };
  /** Mail triage (Phase C): small model and max. mails classified per day. */
  triage: { model: string; dailyLimit: number };
  google?: { clientId: string; clientSecret: string; driveReadAll?: boolean };
  /** Telegram bot (Phase F). Only messages from chatId are accepted. */
  telegram: { botToken?: string; chatId?: string };
  /** Speech-to-text for Telegram voice messages (OpenAI-compatible endpoint, default Groq free tier). */
  transcribe?: { apiKey: string; url: string; model: string };
  /** Optional realistic voice for voice mode (ElevenLabs free tier). */
  elevenlabs?: { apiKey: string; voiceId: string; model: string };
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Ungültige Konfiguration:\n${issues}\nSiehe .env.example`);
  }
  const e = parsed.data;
  if (env.VERCEL && !e.DATABASE_URL) {
    throw new Error("Auf Vercel ist DATABASE_URL (Neon Postgres) erforderlich — das Dateisystem ist nicht dauerhaft. Siehe docs/DEPLOY_VERCEL.md");
  }
  try {
    new Intl.DateTimeFormat("de-DE", { timeZone: e.JARVIS_TIMEZONE });
  } catch {
    throw new Error(`Ungültige Zeitzone JARVIS_TIMEZONE=${e.JARVIS_TIMEZONE}`);
  }
  return {
    anthropicApiKey: e.ANTHROPIC_API_KEY,
    anthropicWorkspaceId: e.ANTHROPIC_WORKSPACE_ID,
    model: e.ANTHROPIC_MODEL,
    accessToken: e.JARVIS_ACCESS_TOKEN,
    encryptionKey: Buffer.from(e.JARVIS_ENCRYPTION_KEY, "base64"),
    host: e.JARVIS_HOST,
    port: e.JARVIS_PORT,
    publicUrl: e.JARVIS_PUBLIC_URL.replace(/\/$/, ""),
    databaseUrl: e.DATABASE_URL,
    dbPath: e.JARVIS_DB_PATH,
    cronSecret: e.CRON_SECRET,
    timezone: e.JARVIS_TIMEZONE,
    language: e.JARVIS_LANGUAGE,
    userName: e.JARVIS_USER_NAME,
    maxAgentSteps: e.JARVIS_MAX_AGENT_STEPS,
    confirmationTtlMinutes: e.JARVIS_CONFIRMATION_TTL_MINUTES,
    compactAtTokens: e.JARVIS_COMPACT_AT_TOKENS,
    browser: { mode: e.JARVIS_BROWSER, url: e.JARVIS_BROWSER_URL, chromiumPath: e.JARVIS_CHROMIUM_PATH, maxSteps: e.JARVIS_BROWSER_MAX_STEPS, taskMinutes: e.JARVIS_BROWSER_TASK_MINUTES },
    triage: { model: e.JARVIS_TRIAGE_MODEL, dailyLimit: e.JARVIS_TRIAGE_DAILY_LIMIT },
    files: { maxBytes: e.JARVIS_MAX_FILE_MB * 1024 * 1024, dbQuotaBytes: e.JARVIS_DB_FILE_QUOTA_MB * 1024 * 1024 },
    google:
      e.GOOGLE_CLIENT_ID && e.GOOGLE_CLIENT_SECRET
        ? { clientId: e.GOOGLE_CLIENT_ID, clientSecret: e.GOOGLE_CLIENT_SECRET, driveReadAll: e.JARVIS_DRIVE_READ_ALL }
        : undefined,
    telegram: { botToken: e.TELEGRAM_BOT_TOKEN, chatId: e.TELEGRAM_CHAT_ID },
    elevenlabs: e.ELEVENLABS_API_KEY ? { apiKey: e.ELEVENLABS_API_KEY, voiceId: e.ELEVENLABS_VOICE_ID, model: e.ELEVENLABS_MODEL } : undefined,
    transcribe: e.TRANSCRIBE_API_KEY ? { apiKey: e.TRANSCRIBE_API_KEY, url: e.TRANSCRIBE_API_URL, model: e.TRANSCRIBE_MODEL } : undefined,
  };
}
