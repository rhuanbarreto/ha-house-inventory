/**
 * Home Assistant client.
 *
 * Device registry and area registry are only available over the WebSocket
 * API — REST exposes states, but not the device metadata we need. We connect
 * to `<haBaseUrl>/api/websocket`, auth with the bearer token, and request
 * `config/device_registry/list` + `config/area_registry/list` + `config/entity_registry/list`.
 *
 * Works with both a Supervisor token (from inside an add-on) and a
 * long-lived access token (dev mode).
 */

import type { Config } from "./config.ts";

export interface HaDevice {
  id: string;
  name: string | null;
  name_by_user: string | null;
  manufacturer: string | null;
  model: string | null;
  model_id: string | null;
  sw_version: string | null;
  hw_version: string | null;
  serial_number: string | null;
  identifiers: Array<[string, string]>;
  connections: Array<[string, string]>;
  area_id: string | null;
  disabled_by: string | null;
  entry_type: string | null;
}

export interface HaArea {
  area_id: string;
  name: string;
  floor_id: string | null;
  icon: string | null;
}

export interface HaFloor {
  floor_id: string;
  name: string;
  icon: string | null;
  level: number | null;
}

export interface HaEntity {
  entity_id: string;
  device_id: string | null;
  area_id: string | null;
  name: string | null;
  platform: string;
  disabled_by: string | null;
}

export interface HaRegistrySnapshot {
  devices: HaDevice[];
  areas: HaArea[];
  floors: HaFloor[];
  entities: HaEntity[];
  fetchedAt: Date;
}

/**
 * An HA entity we can ask to generate text/data for enrichment.
 * `kind` determines which service we call: `ai_task.generate_data` for
 * AI Tasks (structured), `conversation.process` for conversation agents.
 * We filter out HA's built-in `conversation.home_assistant` default agent
 * because it cannot reach the internet or answer open-ended questions.
 */
export type LlmKind = "ai_task" | "conversation";

export interface LlmEntity {
  entity_id: string;
  kind: LlmKind;
  friendly_name: string | null;
  state: string;
}

interface HaStateRow {
  entity_id: string;
  state: string;
  attributes: Record<string, unknown>;
}

export interface HaConfigEntry {
  entry_id: string;
  domain: string;
  title: string;
  state: string;
  supported_subentry_types: Record<
    string,
    { supports_reconfigure?: boolean } | undefined
  >;
  num_subentries: number;
}

/** Shape of the sub-union we care about from HA's config-flow responses. */
export type HaFlowStep =
  | {
      type: "form";
      flow_id: string;
      step_id: string;
      data_schema: Array<{ name: string; required?: boolean }>;
      errors: Record<string, string> | null;
    }
  | {
      type: "create_entry";
      flow_id: string;
      title: string;
      result?: { subentry_id?: string };
    }
  | { type: "abort"; flow_id: string; reason: string };

type WsMessage = Record<string, unknown> & { id?: number; type: string };

export class HaClient {
  constructor(private readonly config: Config) {}

  private wsUrl(): string {
    const url = this.config.haBaseUrl;
    if (this.config.mode === "addon") {
      // Inside an add-on the documented path is ws://supervisor/core/websocket
      return url.replace(/^http/, "ws") + "/websocket";
    }
    // Dev mode: direct connection → ws(s)://host/api/websocket
    return url.replace(/^http/, "ws") + "/api/websocket";
  }

  async fetchRegistry(): Promise<HaRegistrySnapshot> {
    const ws = new WebSocket(this.wsUrl());
    let nextId = 1;
    const pending = new Map<number, (msg: WsMessage) => void>();

    const send = (msg: WsMessage): Promise<WsMessage> => {
      const id = nextId++;
      msg.id = id;
      return new Promise((resolve, reject) => {
        pending.set(id, resolve);
        ws.send(JSON.stringify(msg));
        setTimeout(() => {
          if (pending.delete(id)) {
            reject(new Error(`HA WS request timed out: ${msg.type}`));
          }
        }, 15_000);
      });
    };

    return new Promise<HaRegistrySnapshot>((resolve, reject) => {
      const token = this.config.haToken;
      ws.onerror = (e) => reject(new Error(`HA WS error: ${String(e)}`));
      ws.onclose = () => {
        for (const [, cb] of pending) cb({ type: "closed" });
      };

      ws.onmessage = async (ev) => {
        const msg = JSON.parse(String(ev.data)) as WsMessage;

        if (msg.type === "auth_required") {
          ws.send(JSON.stringify({ type: "auth", access_token: token }));
          return;
        }
        if (msg.type === "auth_invalid") {
          reject(new Error(`HA auth rejected: ${String(msg.message ?? "")}`));
          ws.close();
          return;
        }
        if (msg.type === "auth_ok") {
          try {
            // Floors registry is newer — tolerate the command being
            // unavailable on older HA versions by catching its promise.
            const [devicesRes, areasRes, entitiesRes, floorsRes] =
              await Promise.all([
                send({ type: "config/device_registry/list" }),
                send({ type: "config/area_registry/list" }),
                send({ type: "config/entity_registry/list" }),
                send({ type: "config/floor_registry/list" }).catch(
                  () =>
                    ({
                      type: "result",
                      result: [] as HaFloor[],
                    }) as unknown as WsMessage,
                ),
              ]);
            const devices = (devicesRes as { result?: HaDevice[] }).result ?? [];
            const areas = (areasRes as { result?: HaArea[] }).result ?? [];
            const entities =
              (entitiesRes as { result?: HaEntity[] }).result ?? [];
            const floors = (floorsRes as { result?: HaFloor[] }).result ?? [];
            resolve({
              devices,
              areas,
              floors,
              entities,
              fetchedAt: new Date(),
            });
          } catch (err) {
            reject(err);
          } finally {
            ws.close();
          }
          return;
        }

        if (typeof msg.id === "number") {
          const cb = pending.get(msg.id);
          if (cb) {
            pending.delete(msg.id);
            cb(msg);
          }
        }
      };
    });
  }

  /**
   * Discover entities we can use for LLM-backed enrichment.
   *
   * Two categories, both via the `/api/states` REST endpoint because entity
   * IDs in HA are user-renameable:
   *   - `ai_task.*`     — structured-output tasks (preferred when available)
   *   - `conversation.*` — free-text agents (fallback). We exclude HA's
   *                        built-in `conversation.home_assistant` default
   *                        agent, which can't reach the internet or answer
   *                        open-ended product questions.
   */
  async discoverLlmEntities(): Promise<LlmEntity[]> {
    const res = await fetch(`${this.config.haBaseUrl}/api/states`, {
      headers: { Authorization: `Bearer ${this.config.haToken}` },
    });
    if (!res.ok) {
      throw new Error(
        `HA /api/states failed: ${res.status} ${res.statusText}`,
      );
    }
    const states = (await res.json()) as HaStateRow[];
    const result: LlmEntity[] = [];
    for (const s of states) {
      const friendly =
        (s.attributes?.["friendly_name"] as string | undefined) ?? null;
      if (s.entity_id.startsWith("ai_task.")) {
        result.push({
          entity_id: s.entity_id,
          kind: "ai_task",
          friendly_name: friendly,
          state: s.state,
        });
      } else if (
        s.entity_id.startsWith("conversation.") &&
        s.entity_id !== "conversation.home_assistant"
      ) {
        result.push({
          entity_id: s.entity_id,
          kind: "conversation",
          friendly_name: friendly,
          state: s.state,
        });
      }
    }
    return result;
  }

  /** List all config entries — used to find LLM integrations we can extend. */
  async listConfigEntries(): Promise<HaConfigEntry[]> {
    const res = await fetch(
      `${this.config.haBaseUrl}/api/config/config_entries/entry`,
      { headers: { Authorization: `Bearer ${this.config.haToken}` } },
    );
    if (!res.ok) {
      throw new Error(
        `HA /api/config/config_entries/entry failed: ${res.status}`,
      );
    }
    return (await res.json()) as HaConfigEntry[];
  }

  /**
   * List LLM integrations that support creating an AI Task as a subentry.
   *
   * In HA 2025.7+, LLM integrations (open_router, openai_conversation, etc.)
   * declare `ai_task_data` in their `supported_subentry_types`. Our plugin
   * can kick off a config-flow on them to create a new AI Task entity
   * without the user leaving the add-on UI.
   */
  async listAiTaskCreatableEntries(): Promise<HaConfigEntry[]> {
    const entries = await this.listConfigEntries();
    return entries.filter(
      (e) =>
        e.state === "loaded" &&
        e.supported_subentry_types &&
        "ai_task_data" in e.supported_subentry_types,
    );
  }

  /** Start a subentry config-flow. Returns the first step (usually a form). */
  async startSubentryFlow(
    entryId: string,
    subentryType: string,
  ): Promise<HaFlowStep> {
    const res = await fetch(
      `${this.config.haBaseUrl}/api/config/config_entries/subentries/flow`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.config.haToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ handler: [entryId, subentryType] }),
      },
    );
    if (!res.ok) {
      throw new Error(
        `Start subentry flow failed: ${res.status} ${await res.text()}`,
      );
    }
    return (await res.json()) as HaFlowStep;
  }

  /** Submit form data to an in-flight subentry config-flow step. */
  async submitSubentryFlow(
    flowId: string,
    data: Record<string, unknown>,
  ): Promise<HaFlowStep> {
    const res = await fetch(
      `${this.config.haBaseUrl}/api/config/config_entries/subentries/flow/${flowId}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.config.haToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(data),
      },
    );
    if (!res.ok) {
      throw new Error(
        `Submit subentry flow failed: ${res.status} ${await res.text()}`,
      );
    }
    return (await res.json()) as HaFlowStep;
  }

  /** Cancel an in-flight subentry flow (best-effort cleanup on error paths). */
  async cancelSubentryFlow(flowId: string): Promise<void> {
    await fetch(
      `${this.config.haBaseUrl}/api/config/config_entries/subentries/flow/${flowId}`,
      {
        method: "DELETE",
        headers: { Authorization: `Bearer ${this.config.haToken}` },
      },
    ).catch(() => undefined);
  }

  /**
   * Call a Home Assistant service via the REST API.
   * Used to invoke `ai_task.generate_data` for enrichment.
   */
  async callService(
    domain: string,
    service: string,
    serviceData: Record<string, unknown>,
    returnResponse = false,
  ): Promise<unknown> {
    const url = `${this.config.haBaseUrl}/api/services/${domain}/${service}${returnResponse ? "?return_response" : ""}`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.config.haToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(serviceData),
    });
    if (!res.ok) {
      throw new Error(
        `HA service call failed (${domain}.${service}): ${res.status} ${res.statusText}`,
      );
    }
    return res.json();
  }
}
