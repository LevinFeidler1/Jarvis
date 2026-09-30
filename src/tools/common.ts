import { z } from "zod";
import type { ExternalDataInfo, ToolDefinition, ToolResult } from "../core/types.js";

export const ok = (data: unknown): ToolResult => ({ ok: true, data });

/** Result containing third-party content; the agent wraps and scans it. */
export const external = (source: string, data: unknown, texts: string[]): ToolResult => ({
  ok: true,
  data,
  externalData: { source, texts } satisfies ExternalDataInfo,
});

export const fail = (error: string, code: Extract<ToolResult, { ok: false }>["code"] = "INTERNAL"): ToolResult => ({
  ok: false,
  error,
  code,
});

/** Header-safe single line (prevents header injection in outgoing mail). */
export const singleLine = (max: number) =>
  z
    .string()
    .max(max)
    .refine((v) => !/[\r\n]/.test(v), "darf keine Zeilenumbrüche enthalten");

export const emailAddress = z.email("ungültige E-Mail-Adresse").max(254);

export const isoDateTime = z.iso.datetime({ offset: true, error: "ISO-8601 mit Zeitzonen-Offset erwartet, z.B. 2026-10-01T14:00:00+02:00" });

export const isoDateOrDateTime = z.union([isoDateTime, z.iso.date()]);

export const id = z.string().min(1).max(256);

export function defineTool<I>(def: ToolDefinition<I>): ToolDefinition<I> {
  return def;
}
