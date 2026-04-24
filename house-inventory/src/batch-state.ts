/**
 * Tiny in-process state for the currently-running manual batch.
 *
 * Kicked off by POST /api/enrich/batch, read by the dashboard renderer so
 * the user can see "batch running" feedback after their redirect. The
 * state is in-memory (per container), which is fine because a batch only
 * makes sense within a single running instance.
 */

export interface InFlightBatch {
  startedAt: string;
  max: number;
}

let current: InFlightBatch | null = null;

export function setInFlightBatch(state: InFlightBatch | null): void {
  current = state;
}

export function getInFlightBatch(): InFlightBatch | null {
  return current;
}
