import { z } from "zod";
import type Anthropic from "@anthropic-ai/sdk";
import type { ToolDefinition } from "../core/types.js";
import { automationTools } from "./automation.js";
import { browserTools } from "./browser.js";
import { driveTools } from "./drive.js";
import { fileTools } from "./files.js";
import { calendarTools } from "./calendar.js";
import { emailTools } from "./email.js";
import { contactTools, memoryTools, reminderTools, systemTools, taskTools } from "./personal.js";

/**
 * The closed set of tools JARVIS can use. The model can only call names in
 * this registry; nothing registers tools at runtime.
 */
export class ToolRegistry {
  private readonly tools = new Map<string, ToolDefinition>();

  constructor(tools: ToolDefinition[]) {
    for (const t of tools) {
      if (this.tools.has(t.name)) throw new Error(`Doppeltes Tool: ${t.name}`);
      this.tools.set(t.name, t);
    }
    Object.freeze(this);
  }

  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  all(): ToolDefinition[] {
    return [...this.tools.values()];
  }

  /** Deterministic order (by name) keeps the prompt-cache prefix stable. */
  toAnthropicTools(): Anthropic.Tool[] {
    return this.all()
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((t) => {
        const schema = z.toJSONSchema(t.input, { target: "draft-7", io: "input" }) as Record<string, unknown>;
        delete schema.$schema;
        stripRedundantPatterns(schema);
        return {
          name: t.name,
          description: t.description,
          input_schema: { ...schema, type: "object" } as Anthropic.Tool.InputSchema,
        };
      });
  }
}

/**
 * zod emits long regexes next to `format` (date-time, email). They add many
 * tokens but no value for the model; inputs are validated with zod anyway.
 */
function stripRedundantPatterns(node: unknown): void {
  if (Array.isArray(node)) return node.forEach(stripRedundantPatterns);
  if (!node || typeof node !== "object") return;
  const obj = node as Record<string, unknown>;
  if (typeof obj.format === "string" && typeof obj.pattern === "string") delete obj.pattern;
  Object.values(obj).forEach(stripRedundantPatterns);
}

export function createDefaultRegistry(): ToolRegistry {
  return new ToolRegistry([...emailTools, ...calendarTools, ...contactTools, ...taskTools, ...reminderTools, ...memoryTools, ...systemTools, ...automationTools, ...fileTools, ...driveTools, ...browserTools]);
}
