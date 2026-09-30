import type { FastifyInstance } from "fastify";
import { type AppConfig, loadConfig } from "./config.js";
import { Agent } from "./core/agent.js";
import { AnthropicLlm, UnconfiguredLlm } from "./core/llm.js";
import { Scheduler } from "./core/scheduler.js";
import { type Db, openDatabase } from "./db/database.js";
import { MemoryStore } from "./memory/memory.js";
import { ProviderHub } from "./providers/hub.js";
import { TokenStore } from "./security/token-store.js";
import { createServer } from "./server.js";
import { createDefaultRegistry } from "./tools/registry.js";

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
  const db = await openDatabase({ url: config.databaseUrl, localPath: config.dbPath });
  const memory = new MemoryStore(db);
  const providers = new ProviderHub(config, db, new TokenStore(db, config.encryptionKey));
  const registry = createDefaultRegistry();
  const llmConfigured = !!config.anthropicApiKey;
  const llm = llmConfigured
    ? new AnthropicLlm({ apiKey: config.anthropicApiKey, model: config.model, enableWebSearch: process.env.JARVIS_WEB_SEARCH !== "false" })
    : new UnconfiguredLlm();

  const agent = new Agent({ config, db, llm, registry, providers, memory });
  const scheduler = new Scheduler(providers);
  const app = await createServer({ config, db, agent, providers, memory, registry, scheduler, llmConfigured, serveStatic: opts.serveStatic });
  return { app, config, db, providers, scheduler, llmConfigured };
}
