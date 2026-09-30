import "dotenv/config";
import { loadConfig } from "./config.js";
import { Agent } from "./core/agent.js";
import { AnthropicLlm, UnconfiguredLlm } from "./core/llm.js";
import { Scheduler } from "./core/scheduler.js";
import { openDatabase } from "./db/database.js";
import { MemoryStore } from "./memory/memory.js";
import { ProviderHub } from "./providers/hub.js";
import { TokenStore } from "./security/token-store.js";
import { createServer } from "./server.js";
import { createDefaultRegistry } from "./tools/registry.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const db = openDatabase(config.dbPath);
  const memory = new MemoryStore(db);
  const providers = new ProviderHub(config, db, new TokenStore(db, config.encryptionKey));
  const registry = createDefaultRegistry();
  const llmConfigured = !!config.anthropicApiKey;
  const llm = llmConfigured
    ? new AnthropicLlm({ apiKey: config.anthropicApiKey, model: config.model, enableWebSearch: process.env.JARVIS_WEB_SEARCH !== "false" })
    : new UnconfiguredLlm();

  const agent = new Agent({ config, db, llm, registry, providers, memory });
  const app = await createServer({ config, db, agent, providers, memory, registry, llmConfigured });
  const scheduler = new Scheduler(providers);
  scheduler.start();

  const shutdown = async () => {
    scheduler.stop();
    await app.close();
    db.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  await app.listen({ host: config.host, port: config.port });
  const integrations = providers.status().map((i) => `  ${i.state === "connected" ? "✓" : "○"} ${i.name}: ${i.detail}`);
  console.log(
    `\nJARVIS läuft auf ${config.publicUrl}\n` +
      `  ${llmConfigured ? "✓" : "○"} Sprachmodell: ${llmConfigured ? config.model : "nicht konfiguriert (ANTHROPIC_API_KEY)"}\n` +
      `${integrations.join("\n")}\n`,
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
