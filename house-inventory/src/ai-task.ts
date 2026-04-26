/**
 * Thin wrapper over Home Assistant's `ai_task.generate_data` service.
 *
 * The service accepts an entity_id (any `ai_task.*`), a free-text
 * `instructions` prompt, and an optional `structure` describing the JSON
 * shape we want back. With `return_response=true` HA forwards the result
 * synchronously in the response body.
 *
 * Schema shape (from HA source, voluptuous-on-the-wire):
 *   structure:
 *     field_name:
 *       description: human-readable description for the model
 *       required: true | false
 *       selector:
 *         text: {}       # "text" is the default; we only use strings here.
 *
 * If the configured LLM is a `conversation.*` entity instead of an AI
 * Task, we fall back to `conversation.process` and parse JSON out of the
 * free-text response. Less reliable, but keeps the feature working when
 * the user hasn't set up AI Task yet.
 */

import type { HaClient } from "./ha-client.ts";

export interface GenerateOptions<T> {
  entityId: string;
  taskName: string;
  instructions: string;
  /** Map of field name → metadata describing the desired output. */
  structure: Record<string, FieldDef>;
}

export interface FieldDef {
  description: string;
  required?: boolean;
}

export async function generateStructured<T extends Record<string, unknown>>(
  ha: HaClient,
  opts: GenerateOptions<T>,
): Promise<T> {
  const kind = entityKind(opts.entityId);

  if (kind === "ai_task") {
    const payload = {
      entity_id: opts.entityId,
      task_name: opts.taskName,
      instructions: opts.instructions,
      structure: Object.fromEntries(
        Object.entries(opts.structure).map(([name, def]) => [
          name,
          {
            description: def.description,
            required: def.required ?? false,
            selector: { text: {} },
          },
        ]),
      ),
    };
    const raw = await callWithRetry(
      () => ha.callService("ai_task", "generate_data", payload, true) as Promise<AiTaskResponse<T>>,
    );
    const data = raw?.service_response?.data;
    if (!data) {
      throw new Error(`ai_task.generate_data returned no data: ${JSON.stringify(raw)}`);
    }
    return data;
  }

  // conversation.process fallback — ask for JSON inside fences and parse.
  const fenced = buildConversationPrompt(opts);
  const raw = await callWithRetry(
    () =>
      ha.callService(
        "conversation",
        "process",
        { agent_id: opts.entityId, text: fenced },
        true,
      ) as Promise<ConversationResponse>,
  );
  const text = raw?.service_response?.response?.speech?.plain?.speech ?? "";
  return extractJson<T>(text);
}

/**
 * Call the wrapped HA service once, and if it failed with a transient
 * upstream error (5xx), wait briefly and retry once more.
 *
 * The free OpenRouter routing layer in particular returns sporadic 500s; a
 * single retry turns ~15% of our observed failures into successes without
 * any meaningful cost to cadence.
 */
async function callWithRetry<T>(fn: () => Promise<T>, delayMs = 1500): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    const msg = (err as Error).message;
    if (!isTransient5xx(msg)) throw err;
    await new Promise((r) => setTimeout(r, delayMs));
    return await fn();
  }
}

function isTransient5xx(message: string): boolean {
  return /\b(500|502|503|504)\b/.test(message);
}

function entityKind(entityId: string): "ai_task" | "conversation" {
  if (entityId.startsWith("ai_task.")) return "ai_task";
  if (entityId.startsWith("conversation.")) return "conversation";
  throw new Error(`Unsupported LLM entity_id: ${entityId}`);
}

function buildConversationPrompt<T>(opts: GenerateOptions<T>): string {
  const fields = Object.entries(opts.structure)
    .map(([name, def]) => `  - ${name}${def.required ? " (required)" : ""}: ${def.description}`)
    .join("\n");
  return `${opts.instructions}

Respond with ONLY a JSON object inside a \`\`\`json fenced block. Fields:
${fields}

If a field is not known, use null. Do not include any prose before or after the block.`;
}

function extractJson<T>(text: string): T {
  const fenced = text.match(/```json\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1] ?? text.match(/\{[\s\S]*\}/)?.[0];
  if (!candidate) {
    throw new Error(`No JSON found in conversation response: ${text.slice(0, 200)}`);
  }
  try {
    return JSON.parse(candidate) as T;
  } catch (err) {
    throw new Error(`Invalid JSON in conversation response: ${(err as Error).message}`);
  }
}

// HA's response shapes we care about.
interface AiTaskResponse<T> {
  service_response?: { data?: T };
}
interface ConversationResponse {
  service_response?: {
    response?: { speech?: { plain?: { speech?: string } } };
  };
}
