import { z } from "zod";
import { describeTrigger, type AutomationTrigger } from "../core/automations.js";
import { buildWeekReview } from "../core/review.js";
import { RiskLevel, type ToolDefinition } from "../core/types.js";
import { defineTool, fail, id, ok } from "./common.js";

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Uhrzeit als HH:MM, z.B. 07:30");

export const automationTriggerSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("schedule"),
    time: hhmm,
    days: z.array(z.number().int().min(1).max(7)).min(1).max(7).describe("Wochentage, 1=Montag … 7=Sonntag"),
  }),
  z.object({
    type: z.literal("email"),
    from: z.string().trim().min(1).max(200).optional().describe("Absender-Name oder -Adresse enthält"),
    subject: z.string().trim().min(1).max(200).optional().describe("Betreff enthält"),
  }),
]);

export const automationTools: ToolDefinition[] = [
  defineTool({
    name: "list_automations",
    description: "Listet die eingerichteten Automationen (Zeitpläne und E-Mail-Auslöser) mit Status und letztem Ergebnis.",
    category: "system",
    risk: RiskLevel.READ,
    input: z.object({}),
    describe: () => "Automationen anzeigen",
    async execute(_input, ctx) {
      const list = await ctx.providers.automations.list();
      return ok(list.map((a) => ({ id: a.id, name: a.name, trigger: describeTrigger(a.trigger), enabled: a.enabled, prompt: a.prompt, lastRunAt: a.lastRunAt, lastStatus: a.lastStatus })));
    },
  }),
  defineTool({
    name: "create_automation",
    description:
      "Richtet eine wiederkehrende Automation ein, die JARVIS ohne Zutun des Benutzers ausführt und das Ergebnis als Push-Nachricht schickt. " +
      "trigger.type='schedule' (Uhrzeit + Wochentage) oder 'email' (neue E-Mail, deren Absender/Betreff etwas enthält). " +
      "prompt ist der Auftrag an JARVIS bei jeder Ausführung. Nur auf ausdrücklichen Wunsch des Benutzers.",
    category: "system",
    // Unattended runs are powerful: creating one always needs the user's confirmation.
    risk: RiskLevel.EXTERNAL,
    input: z.object({
      name: z.string().trim().min(1).max(80),
      prompt: z.string().trim().min(5).max(2000),
      trigger: automationTriggerSchema,
    }),
    describe: (i) => `Automation einrichten: „${i.name}“ — ${describeTrigger(i.trigger as AutomationTrigger)}\nAuftrag: ${i.prompt}`,
    async execute(input, ctx) {
      const a = await ctx.providers.automations.create(input as { name: string; prompt: string; trigger: AutomationTrigger }, ctx.now());
      return ok({ id: a.id, name: a.name, trigger: describeTrigger(a.trigger), nextRunAt: a.nextRunAt });
    },
  }),
  defineTool({
    name: "set_automation_enabled",
    description: "Pausiert oder aktiviert eine Automation.",
    category: "system",
    risk: RiskLevel.EXTERNAL,
    input: z.object({ automation_id: id, enabled: z.boolean() }),
    describe: (i) => `Automation ${i.enabled ? "aktivieren" : "pausieren"}`,
    async execute(input, ctx) {
      const a = await ctx.providers.automations.update(input.automation_id, { enabled: input.enabled }, ctx.now());
      return a ? ok({ id: a.id, name: a.name, enabled: a.enabled }) : fail("Automation nicht gefunden", "NOT_FOUND");
    },
  }),
  defineTool({
    name: "delete_automation",
    description: "Löscht eine Automation endgültig.",
    category: "system",
    risk: RiskLevel.EXTERNAL,
    input: z.object({ automation_id: id }),
    describe: () => "Automation löschen",
    async execute(input, ctx) {
      return (await ctx.providers.automations.delete(input.automation_id)) ? ok({ deleted: true }) : fail("Automation nicht gefunden", "NOT_FOUND");
    },
  }),
  defineTool({
    name: "get_week_review",
    description:
      "Wochenrückblick: was JARVIS und der Benutzer in einer Woche erledigt haben (gesendete E-Mails, Termine, erledigte Aufgaben, " +
      "Erinnerungen, Automationen, Kosten) plus Ausblick auf die Folgewoche. week_offset 0 = diese Woche, -1 = letzte Woche.",
    category: "system",
    risk: RiskLevel.READ,
    input: z.object({ week_offset: z.number().int().min(-52).max(0).optional() }),
    describe: (i) => `Wochenrückblick${i.week_offset ? ` (${i.week_offset} Wochen)` : ""}`,
    async execute(input, ctx) {
      return ok(await buildWeekReview({ db: ctx.db, providers: ctx.providers, config: ctx.config }, input.week_offset ?? 0, ctx.now()));
    },
  }),
];
