/** Shared TypeScript interfaces for the House Inventory SPA. */

// -- Config --
export interface AppConfig {
  ingressPath: string;
  mode: string;
  user: {
    id: string | null;
    name: string | null;
    displayName: string | null;
  };
}

// -- Dashboard --
export interface DashboardData {
  totals: {
    total: number;
    visible: number;
    hidden: number;
    manual: number;
    with_links: number;
    with_pdf: number;
    areas: number;
  };
  lastSync: SyncEntry | null;
  llmEntityId: string | null;
  enrichStatus: QueueStatus;
  enriched: number;
  inFlight: InFlightBatch | null;
  mode: string;
  dataDir: string;
}

export interface SyncEntry {
  started_at: string;
  finished_at: string | null;
  error: string | null;
  devices_added: number;
  devices_updated: number;
}

export interface QueueStatus {
  total_eligible: number;
  never_attempted: number;
  stale: number;
  failed_in_backoff: number;
  last_success_at: string | null;
}

export interface InFlightBatch {
  startedAt: string;
  max: number;
}

// -- Assets --
export interface AssetListItem {
  id: string;
  name: string;
  manufacturer: string | null;
  model: string | null;
  area_id: string | null;
  area_name: string | null;
  source: string;
  hidden: number;
  hidden_reason: string | null;
}

export interface AssetListResponse {
  count: number;
  assets: AssetListItem[];
}

export interface AssetDetail {
  id: string;
  source: string;
  ha_device_id: string | null;
  name: string;
  manufacturer: string | null;
  model: string | null;
  model_id: string | null;
  sw_version: string | null;
  hw_version: string | null;
  serial_number: string | null;
  area_id: string | null;
  category: string | null;
  purchase_date: string | null;
  purchase_price_cents: number | null;
  warranty_until: string | null;
  notes: string | null;
  hidden: number;
  hidden_reason: string | null;
  created_at: string;
  updated_at: string;
  last_seen_at: string | null;
  last_enrichment_attempt_at: string | null;
  last_enrichment_success_at: string | null;
  last_enrichment_error: string | null;
  enrichment_attempts: number;
}

export interface AssetLink {
  id: number;
  kind: string;
  url: string;
  title: string | null;
  fetched_at: string;
}

export interface AssetFile {
  id: number;
  kind: string;
  local_path: string;
  sha256: string;
  bytes: number;
  downloaded_at: string;
}

export interface AssetDetailResponse {
  asset: AssetDetail;
  links: AssetLink[];
  files: AssetFile[];
}

export interface CreateAssetPayload {
  name: string;
  manufacturer?: string | null;
  model?: string | null;
  category?: string | null;
  area_id?: string | null;
  purchase_date?: string | null;
  purchase_price?: string | null;
  warranty_until?: string | null;
  notes?: string | null;
}

export interface UpdateAssetPayload {
  category?: string | null;
  area_id?: string | null;
  purchase_date?: string | null;
  purchase_price?: string | null;
  warranty_until?: string | null;
  notes?: string | null;
}

// -- Areas --
export interface Floor {
  id: string;
  name: string;
  icon: string | null;
  level: number | null;
}

export interface AreaItem {
  id: string;
  name: string;
  icon: string | null;
  floor_id: string | null;
  visible_count: number;
  hidden_count: number;
  enriched_count: number;
}

export interface AreasResponse {
  floors: Floor[];
  areas: AreaItem[];
  unassignedAssets: number;
}

// -- LLM --
export interface LlmEntity {
  entity_id: string;
  friendly_name: string | null;
  kind: "ai_task" | "conversation";
}

export interface LlmDiscovery {
  current: string | null;
  discovered: LlmEntity[];
  counts: { ai_tasks: number; conversation_agents: number };
  autoSelectable: string | null;
}

export interface CreatableEntry {
  entry_id: string;
  domain: string;
  title: string;
  existing_subentries: number;
}

export interface CreatableEntriesResponse {
  count: number;
  entries: CreatableEntry[];
}

// -- Sync --
export interface SyncResult {
  devicesAdded: number;
  devicesUpdated: number;
  devicesHidden: number;
  areasUpserted: number;
  error?: string;
}

export interface SyncLogEntry {
  id: number;
  started_at: string;
  finished_at: string | null;
  devices_added: number;
  devices_updated: number;
  devices_hidden: number;
  areas_upserted: number;
  error: string | null;
}

// -- Enrich --
export interface EnrichResult {
  cache: string;
  links: Record<string, string | null>;
  manual_downloaded: boolean;
}

// -- Flash messages --
export type FlashKind = "ok" | "err" | "info";
export interface FlashMessage {
  id: number;
  kind: FlashKind;
  text: string;
}
