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
  entities: HaEntity[];
  fetchedAt: Date;
}

type WsMessage = Record<string, unknown> & { id?: number; type: string };

export class HaClient {
  constructor(private readonly config: Config) {}

  private wsUrl(): string {
    // http(s)://host → ws(s)://host/api/websocket
    const url = this.config.haBaseUrl;
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
            const [devicesRes, areasRes, entitiesRes] = await Promise.all([
              send({ type: "config/device_registry/list" }),
              send({ type: "config/area_registry/list" }),
              send({ type: "config/entity_registry/list" }),
            ]);
            const devices = (devicesRes as { result?: HaDevice[] }).result ?? [];
            const areas = (areasRes as { result?: HaArea[] }).result ?? [];
            const entities =
              (entitiesRes as { result?: HaEntity[] }).result ?? [];
            resolve({ devices, areas, entities, fetchedAt: new Date() });
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
