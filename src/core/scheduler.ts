import type { ProviderHub } from "../providers/hub.js";

/**
 * Fires due reminders as in-app notifications. Runs in-process; recurring
 * automations (Phase 3) will be built on the same loop.
 */
export class Scheduler {
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly providers: ProviderHub,
    private readonly intervalMs = 30_000,
  ) {}

  start(): void {
    this.tick().catch((err) => console.error("[scheduler]", err));
    this.timer = setInterval(() => this.tick().catch((err) => console.error("[scheduler]", err)), this.intervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async tick(now = new Date()): Promise<number> {
    const due = this.providers.reminders.takeDue(now);
    for (const r of due) await this.providers.notifications.notify("Erinnerung", r.text);
    return due.length;
  }
}
