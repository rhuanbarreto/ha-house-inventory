/**
 * LLM picker page — select/create/clear AI task entities.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { llmQuery, llmCreatableQuery, keys } from "../query.ts";
import { api } from "../api.ts";
import { useFlash } from "../hooks/useFlash.ts";
import { Tag } from "../components/Tag.tsx";
import type { LlmEntity, CreatableEntry } from "../types.ts";

export function LlmPage() {
  const { flash } = useFlash();
  const qc = useQueryClient();
  const { data: llm, isLoading: llmLoading } = useQuery(llmQuery);
  const { data: creatable } = useQuery(llmCreatableQuery);

  const clearMut = useMutation({
    mutationFn: () => api.clearLlm(),
    onSuccess: () => {
      flash("ok", "Cleared");
      qc.invalidateQueries({ queryKey: keys.llm });
      qc.invalidateQueries({ queryKey: keys.dashboard });
    },
    onError: (e) => flash("err", e.message),
  });

  if (llmLoading || !llm) return <div className="card empty">Loading…</div>;

  const current = llm.current;
  const aiTasks = llm.discovered.filter((e) => e.kind === "ai_task");
  const conversationAgents = llm.discovered.filter((e) => e.kind === "conversation");

  return (
    <>
      <h1>LLM for enrichment</h1>

      <div className="card mb-16">
        {current ? (
          <>
            <strong>Currently selected:</strong> <code>{current}</code>
            <button
              className="btn ml-8"
              onClick={() => clearMut.mutate()}
              disabled={clearMut.isPending}
            >
              Clear
            </button>
          </>
        ) : (
          <strong>
            No LLM selected. Pick an AI Task or conversation agent below, or create a new AI Task
            from an existing LLM integration.
          </strong>
        )}
      </div>

      <h2>
        AI Tasks <span className="h2-hint">· preferred</span>
      </h2>
      {aiTasks.length === 0 ? (
        <div className="card empty">No AI Tasks found. Create one below.</div>
      ) : (
        <EntityTable entities={aiTasks} currentId={current} />
      )}

      {creatable && creatable.entries.length > 0 && (
        <>
          <h2>Create a new AI Task</h2>
          {creatable.entries.map((e) => (
            <CreateForm key={e.entry_id} entry={e} />
          ))}
        </>
      )}

      <h2>
        Conversation agents <span className="h2-hint">· fallback</span>
      </h2>
      {conversationAgents.length === 0 ? (
        <div className="card empty">
          No conversation agents found (except HA's built-in Assist, which is filtered out).
        </div>
      ) : (
        <EntityTable entities={conversationAgents} currentId={current} />
      )}
    </>
  );
}

// -- Entity table with Select buttons -----------------------------------------

function EntityTable({ entities, currentId }: { entities: LlmEntity[]; currentId: string | null }) {
  const { flash } = useFlash();
  const qc = useQueryClient();

  const selectMut = useMutation({
    mutationFn: (entityId: string) => api.selectLlm(entityId),
    onSuccess: (_, entityId) => {
      flash("ok", `Selected ${entityId}`);
      qc.invalidateQueries({ queryKey: keys.llm });
      qc.invalidateQueries({ queryKey: keys.dashboard });
    },
    onError: (e) => flash("err", e.message),
  });

  return (
    <table className="rows">
      <thead>
        <tr>
          <th>Entity</th>
          <th>Friendly name</th>
          <th>Kind</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        {entities.map((e) => (
          <tr key={e.entity_id}>
            <td>
              <code>{e.entity_id}</code>
            </td>
            <td>{e.friendly_name ?? "—"}</td>
            <td>
              <Tag variant={e.kind === "ai_task" ? "good" : "default"}>{e.kind}</Tag>
            </td>
            <td>
              {currentId === e.entity_id ? (
                <Tag variant="accent">selected</Tag>
              ) : (
                <button
                  className="btn"
                  onClick={() => selectMut.mutate(e.entity_id)}
                  disabled={selectMut.isPending}
                >
                  Select
                </button>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// -- Create AI Task form ------------------------------------------------------

function CreateForm({ entry }: { entry: CreatableEntry }) {
  const { flash } = useFlash();
  const qc = useQueryClient();
  const [model, setModel] = useState("");

  const mutation = useMutation({
    mutationFn: () => api.createAiTask(entry.entry_id, model.trim() || undefined),
    onSuccess: (r) => {
      if (r.entity_id) {
        flash("ok", `Created ${r.entity_id}`);
      } else {
        flash("info", "Subentry created but entity didn't surface — refresh in a moment.");
      }
      qc.invalidateQueries({ queryKey: keys.llm });
      qc.invalidateQueries({ queryKey: keys.llmCreatable });
      qc.invalidateQueries({ queryKey: keys.dashboard });
    },
    onError: (e) => flash("err", e.message),
  });

  return (
    <form
      className="card form-stack mb-12"
      onSubmit={(e) => {
        e.preventDefault();
        mutation.mutate();
      }}
    >
      <div>
        <strong>{entry.title}</strong>
        <span className="muted text-dim">
          {" "}
          · {entry.domain} · {entry.existing_subentries} existing subentr
          {entry.existing_subentries === 1 ? "y" : "ies"}
        </span>
      </div>
      <label>
        <span>Model</span>
        <input
          type="text"
          value={model}
          onChange={(e) => setModel(e.target.value)}
          placeholder="e.g. openrouter/free, anthropic/claude-haiku-4.5"
          required
        />
      </label>
      <div className="actions">
        <button className="btn primary" type="submit" disabled={mutation.isPending}>
          {mutation.isPending ? "Creating…" : "Create AI Task"}
        </button>
      </div>
    </form>
  );
}
