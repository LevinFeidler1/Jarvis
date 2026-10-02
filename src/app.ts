import type { FastifyInstance } from "fastify";
import { type AppConfig, loadConfig } from "./config.js";
import { Agent } from "./core/agent.js";
import { AnthropicLlm, UnconfiguredLlm } from "./core/llm.js";
import { AutomationRunner } from "./core/automations.js";
import { Scheduler } from "./core/scheduler.js";
import { TriageService } from "./core/triage.js";
import { AnthropicMailClassifier } from "./core/triage-classifier.js";
import { type Db, openDatabase } from "./db/database.js";
import { MemoryStore } from "./memory/memory.js";
import { ProviderHub } from "./providers/hub.js";
import { TokenStore } from "./security/token-store.js";
import { createServer } from "./server.js";
import { createDefaultRegistry } from "./tools/registry.js";
import { TelegramApi } from "./telegram/api.js";
import { TelegramBot } from "./telegram/bot.js";
import { OpenAiCompatibleTranscriber } from "./telegram/transcribe.js";

export interface Jarvis {
  app: FastifyInstance;
  config: AppConfig;
  db: Db;
  providers: ProviderHub;
  scheduler: Scheduler;
  llmConfigured: boolean;
}

/** Wires everything together. Shared by the local server and the Vercel function. */
export async function buildJarvis(opts: { serveStatic?: boolean } = {}): Promise<Jarvis> {
  const config = loadConfig();
  const db = await openDatabase({ url: config.databaseUrl, unpooledUrl: config.databaseUrlUnpooled, localPath: config.dbPath });
  const memory = new MemoryStore(db);
  const providers = new ProviderHub(config, db, new TokenStore(db, config.encryptionKey));
  const registry = createDefaultRegistry();
  const llmConfigured = !!config.anthropicApiKey;
  const llm = llmConfigured
    ? new AnthropicLlm({ apiKey: config.anthropicApiKey, workspaceId: config.anthropicWorkspaceId, model: config.model, enableWebSearch: process.env.JARVIS_WEB_SEARCH !== "false", compactAtTokens: config.compactAtTokens })
    : new UnconfiguredLlm();

  const agent = new Agent({ config, db, llm, registry, providers, memory });
  const scheduler = new Scheduler(providers);
  scheduler.setAutomationRunner(new AutomationRunner(providers.automations, agent, providers));
  const triage = new TriageService({
    db,
    config,
    providers,
    memory,
    agent,
    dailyLimit: config.triage.dailyLimit,
    classifier: llmConfigured
      ? new AnthropicMailClassifier({ apiKey: config.anthropicApiKey, workspaceId: config.anthropicWorkspaceId, model: config.triage.model })
      : undefined,
  });
  scheduler.setTriage(triage);
  const telegram = config.telegram.botToken
    ? new TelegramBot({
        config,
        db,
        agent,
        providers,
        triage,
        api: new TelegramApi(config.telegram.botToken),
        transcriber: config.transcribe ? new OpenAiCompatibleTranscriber(config.transcribe) : undefined,
      })
    : undefined;
  if (telegram) providers.notifications.addMirror((title, body, o) => telegram.notify(title, body, o));
  const app = await createServer({ config, db, agent, providers, memory, registry, scheduler, triage, telegram, llmConfigured, serveStatic: opts.serveStatic });
  return { app, config, db, providers, scheduler, llmConfigured };
}
