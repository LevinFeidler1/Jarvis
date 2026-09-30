import type { ProviderHub } from "../providers/hub.js";
import type { AutomationRunner } from "./automations.js";

/**
 * Fires due reminders (as in-app + push notifications) and runs due
 * automations. Locally it runs in-process every 30 s; on Vercel the cron
 * endpoint /api/cron/tick drives it (plus reminders on every UI poll).
 */
export class Scheduler {
  private timer?: NodeJS.Timeout;
  private automations?: AutomationRunner;

  constructor(
    private readonly providers: ProviderHub,
    private readonly intervalMs = 30_000,
  ) {}

  setAutomationRunner(runner: AutomationRunner): void {
    this.automations = runner;
  }

  start(): void {
    const run = () => this.tick(new Date(), { automations: true }).catch((err) => console.error("[scheduler]", err));
    run();
    this.timer = setInterval(run, this.intervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Runs due automations only (no-op without a runner). */
  async runAutomations(now = new Date()): Promise<number> {
    return this.automations ? this.automations.runDue(now) : 0;
  }

  /** Returns the number of reminders fired (and automations run, when enabled). */
  async tick(now = new Date(), opts: { automations?: boolean } = {}): Promise<number> {
    const due = await this.providers.reminders.takeDue(now);
    for (const r of due) await this.providers.notifications.notify("⏰ Erinnerung", r.text, { url: "/#tasks", tag: `reminder-${r.id}` });
    let runs = 0;
    if (opts.automations && this.automations) runs = await this.automations.runDue(now);
    return due.length + runs;
  }
}
