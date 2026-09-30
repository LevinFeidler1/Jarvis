import type { Db } from "../db/database.js";
import { nowIso } from "../db/database.js";
import type { RiskLevel } from "./types.js";

export type AuditStatus = "SUCCESS" | "FAILED" | "PARTIAL" | "REJECTED" | "DENIED" | "EXPIRED";

export interface AuditEntry {
  action: string;
  target?: string;
  risk: RiskLevel;
  status: AuditStatus;
  userConfirmation: boolean;
  details?: Record<string, unknown>;
}

/** Keys whose values must never reach the audit log (SECURITY.md §6). */
const SECRET_KEYS = /pass(word|wort)?|secret|token|key|code|otp|tan|body|text|content|message|notes?|html/i;

export function maskEmail(value: string): string {
  return value.replace(/([A-Za-z0-9._%+-])[A-Za-z0-9._%+-]*@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g, "$1***@$2");
}

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 4) return "[…]";
  if (typeof value === "string") {
    const masked = maskEmail(value);
    return masked.length > 120 ? `${masked.slice(0, 117)}…` : masked;
  }
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => redact(v, depth + 1));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = SECRET_KEYS.test(k) ? "[redacted]" : redact(v, depth + 1);
    }
    return out;
  }
  return value;
}

export class AuditLog {
  constructor(private readonly db: Db) {}

  record(entry: AuditEntry): void {
    this.db
      .prepare(
        `INSERT INTO audit_log (ts, action, target, risk, status, user_confirmation, details_json)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        nowIso(),
        entry.action,
        entry.target ? maskEmail(entry.target) : null,
        entry.risk,
        entry.status,
        entry.userConfirmation ? 1 : 0,
        entry.details ? JSON.stringify(redact(entry.details)) : null,
      );
  }

  list(limit = 100): Array<Record<string, unknown>> {
    return this.db
      .prepare(
        `SELECT id, ts, action, target, risk, status, user_confirmation AS userConfirmation, details_json AS details
         FROM audit_log ORDER BY id DESC LIMIT ?`,
      )
      .all(limit)
      .map((r) => ({ ...r, userConfirmation: r.userConfirmation === 1, details: r.details ? JSON.parse(String(r.details)) : null }));
  }
}
