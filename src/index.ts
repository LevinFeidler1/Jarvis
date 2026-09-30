import "dotenv/config";
import { buildJarvis } from "./app.js";

async function main(): Promise<void> {
  const { app, config, db, providers, scheduler, llmConfigured } = await buildJarvis();
  scheduler.start();

  const shutdown = async () => {
    scheduler.stop();
    await app.close();
    await db.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  await app.listen({ host: config.host, port: config.port });
  const integrations = (await providers.status()).map((i) => `  ${i.state === "connected" ? "✓" : "○"} ${i.name}: ${i.detail}`);
  console.log(
    `\nJARVIS läuft auf ${config.publicUrl}\n` +
      `  ✓ Datenbank: ${config.databaseUrl ? "Postgres" : `PGlite (${config.dbPath})`}\n` +
      `  ${llmConfigured ? "✓" : "○"} Sprachmodell: ${llmConfigured ? config.model : "nicht konfiguriert (ANTHROPIC_API_KEY)"}\n` +
      `${integrations.join("\n")}\n`,
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
