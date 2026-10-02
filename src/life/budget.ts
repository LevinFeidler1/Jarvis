import type { Db } from "../db/database.js";
import { localDate, zonedToUtc } from "../core/time.js";
import { UsageStore } from "../core/usage.js";
import { loadLifeSettings } from "./settings.js";

export interface BudgetStatus {
  /** First day of the current month (local time zone), ISO. */
  monthStart: string;
  spentUsd: number;
  requests: number;
  budgetUsd: number | null;
  /** spent / budget (0 when no budget). */
  ratio: number;
  hardStop: boolean;
  /** true when a budget is set, hard stop is on and the budget is used up. */
  blocked: boolean;
}

/** AI spend this calendar month (estimate from list prices, see core/usage.ts) against the user's budget. */
export async function budgetStatus(db: Db, timezone: string, now = new Date()): Promise<BudgetStatus> {
  const today = localDate(now, timezone);
  const monthStart = zonedToUtc(`${today.slice(0, 7)}-01`, "00:00", timezone).toISOString();
  const totals = await new UsageStore(db).totals(monthStart, new Date(now.getTime() + 1000).toISOString());
  const { budgetUsd, budgetHardStop } = await loadLifeSettings(db);
  const ratio = budgetUsd ? totals.costUsd / budgetUsd : 0;
  return {
    monthStart,
    spentUsd: totals.costUsd,
    requests: totals.requests,
    budgetUsd,
    ratio,
    hardStop: budgetHardStop,
    blocked: !!budgetUsd && budgetHardStop && ratio >= 1,
  };
}

export const usd = (v: number) => `${v.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} $`;
