import type { ProviderHub } from "../providers/hub.js";
import type { AutomationRunner } from "./automations.js";
import type { TriageService } from "./triage.js";
import type { ProactiveService } from "../life/proactive.js";

/** Mail triage runs at most this often (the local scheduler ticks every 30 s). */
const TRIAGE_EVERY_MS = 4.5 * 60_000;
/** Invoices/subscriptions are looked for in the mailbox at most this often (pattern matching, no LLM). */
const FINANCE_SCAN_EVERY_MS = 12 * 60 * 60_000;

/**
 * Fires due reminders (as in-app + push notifications) and runs due
 * automations. Locally it runs in-process every 30 s; on Vercel the cron
 * endpoint /api/cron/tick drives it (plus, in the background, after a UI poll).
 */
export class Scheduler {
  private timer?: NodeJS.Timeout;
  private automations?: AutomationRunner;
  private triage?: TriageService;
  private lastTriage = 0;
  private lastFinanceCheck = 0;
  private proactive?: ProactiveService;
  private lastProactive = 0;

  constructor(
    private readonly providers: ProviderHub,
    private readonly intervalMs = 30_000,
  ) {}

  setAutomationRunner(runner: AutomationRunner): void {
    this.automations = runner;
  }

  setTriage(triage: TriageService): void {
    this.triage = triage;
  }

  setProactive(p: ProactiveService): void {
    this.proactive = p;
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
    let runs = this.automations ? await this.automations.runDue(now) : 0;
    if (this.triage && now.getTime() - this.lastTriage >= TRIAGE_EVERY_MS) {
      this.lastTriage = now.getTime();
      runs += (await this.triage.runTick().catch((err) => (console.error("[triage]", err), { suggestions: 0 }))).suggestions;
    }
    if (this.proactive && now.getTime() - this.lastProactive >= 4 * 60_000) {
      this.lastProactive = now.getTime();
      await this.proactive.run(now).catch((err) => console.error("[proactive]", (err as Error).message));
    }
    if (now.getTime() - this.lastFinanceCheck >= 60 * 60_000) {
      this.lastFinanceCheck = now.getTime();
      await this.scanFinancesIfDue(now).catch((err) => console.error("[finance]", (err as Error).message));
    }
    return runs;
  }

  private async scanFinancesIfDue(now: Date): Promise<void> {
    const { lastScanAt } = await this.providers.finance.overview(now);
    if (lastScanAt && now.getTime() - new Date(lastScanAt).getTime() < FINANCE_SCAN_EVERY_MS) return;
    const email = await this.providers.email().catch(() => undefined);
    if (email) await this.providers.finance.scanMailbox(email, lastScanAt ? 14 : 90);
  }

  /** Returns the number of reminders fired (and automations run, when enabled). */
  async tick(now = new Date(), opts: { automations?: boolean } = {}): Promise<number> {
    const due = await this.providers.reminders.takeDue(now);
    for (const r of due) await this.providers.notifications.notify("⏰ Erinnerung", r.text, { url: "/#tasks", tag: `reminder-${r.id}` });
    let runs = 0;
    if (opts.automations) runs = await this.runAutomations(now);
    return due.length + runs;
  }
}
