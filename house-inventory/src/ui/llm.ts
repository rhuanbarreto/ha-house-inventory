/**
 * LLM picker page. Lists discovered `ai_task.*` and `conversation.*`
 * entities, lets the user pick one, and offers to create a new AI Task
 * on any integration that supports `ai_task_data` subentries.
 */

import type { Database } from "bun:sqlite";
import type { HaClient, LlmEntity, HaConfigEntry } from "../ha-client.ts";
import { getSetting } from "../settings.ts";
import { escapeHtml, renderFlash, renderPage } from "./layout.ts";

export async function renderLlmPage(
  db: Database,
  ha: HaClient,
  flash: string | undefined,
  baseHref: string,
): Promise<string> {
  const current = getSetting(db, "llm_entity_id");

  let entities: LlmEntity[] = [];
  let creatable: HaConfigEntry[] = [];
  let discoveryError: string | null = null;

  try {
    [entities, creatable] = await Promise.all([
      ha.discoverLlmEntities(),
      ha.listAiTaskCreatableEntries(),
    ]);
  } catch (err) {
    discoveryError = (err as Error).message;
  }

  const aiTasks = entities.filter((e) => e.kind === "ai_task");
  const conversationAgents = entities.filter((e) => e.kind === "conversation");

  const entityRow = (e: LlmEntity): string => /* html */ `
    <tr>
      <td><code>${escapeHtml(e.entity_id)}</code></td>
      <td>${escapeHtml(e.friendly_name ?? "—")}</td>
      <td><span class="tag ${e.kind === "ai_task" ? "good" : ""}">${e.kind}</span></td>
      <td>
        ${
          current === e.entity_id
            ? '<span class="tag accent">selected</span>'
            : /* html */ `<form method="post" action="./api/settings/llm" style="margin:0">
                 <input type="hidden" name="entity_id" value="${escapeHtml(e.entity_id)}" />
                 <button class="btn" type="submit">Select</button>
               </form>`
        }
      </td>
    </tr>
  `;

  const body = /* html */ `
    ${renderFlash(flash)}
    <h1>LLM for enrichment</h1>

    ${discoveryError ? `<div class="flash err">Discovery failed: ${escapeHtml(discoveryError)}</div>` : ""}

    <div class="card" style="margin-bottom:16px">
      ${
        current
          ? `<strong>Currently selected:</strong> <code>${escapeHtml(current)}</code>
             <form method="post" action="./api/settings/llm/clear" style="display:inline;margin-left:8px">
               <button class="btn" type="submit">Clear</button>
             </form>`
          : `<strong>No LLM selected.</strong> Pick an AI Task or conversation agent below, or create a new AI Task from an existing LLM integration.`
      }
    </div>

    <h2>AI Tasks <span style="color:var(--text-faint);font-weight:400">· preferred</span></h2>
    ${
      aiTasks.length === 0
        ? '<div class="card empty">No AI Tasks found. Create one below.</div>'
        : /* html */ `
      <table class="rows">
        <thead><tr><th>Entity</th><th>Friendly name</th><th>Kind</th><th></th></tr></thead>
        <tbody>${aiTasks.map(entityRow).join("")}</tbody>
      </table>`
    }

    ${
      creatable.length > 0
        ? /* html */ `
      <h2>Create a new AI Task</h2>
      ${creatable
        .map(
          (e) => /* html */ `
        <form class="card form-stack" method="post" action="./api/llm/create" style="margin-bottom:12px">
          <input type="hidden" name="entry_id" value="${escapeHtml(e.entry_id)}" />
          <div>
            <strong>${escapeHtml(e.title)}</strong>
            <span class="muted" style="color:var(--text-dim)">
              · ${escapeHtml(e.domain)} · ${e.num_subentries} existing subentr${e.num_subentries === 1 ? "y" : "ies"}
            </span>
          </div>
          <label>
            <span>Model</span>
            <input type="text" name="model" placeholder="e.g. openrouter/free, anthropic/claude-haiku-4.5" required />
          </label>
          <div class="actions">
            <button class="btn primary" type="submit">Create AI Task</button>
          </div>
        </form>`,
        )
        .join("")}`
        : ""
    }

    <h2>Conversation agents <span style="color:var(--text-faint);font-weight:400">· fallback</span></h2>
    ${
      conversationAgents.length === 0
        ? '<div class="card empty">No conversation agents found (except HA\'s built-in Assist, which is filtered out).</div>'
        : /* html */ `
      <table class="rows">
        <thead><tr><th>Entity</th><th>Friendly name</th><th>Kind</th><th></th></tr></thead>
        <tbody>${conversationAgents.map(entityRow).join("")}</tbody>
      </table>`
    }
  `;

  return renderPage({ title: "LLM", active: "llm", body, baseHref });
}
