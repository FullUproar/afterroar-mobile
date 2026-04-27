/**
 * Single-surface probe. Returns the result; never throws.
 *
 * Latency budget: 8 seconds. Anything slower is reported as `slow` (state
 * still `healthy` if HTTP 200 came back, but flagged for visibility).
 */

import type { Surface } from "./surfaces";

export type ProbeStatus = "healthy" | "slow" | "degraded" | "unhealthy" | "unreachable";

export interface ProbeResult {
  surface: Surface;
  status: ProbeStatus;
  httpStatus: number | null;
  latencyMs: number;
  detail?: string;
  timestamp: number; // ms since epoch
}

const TIMEOUT_MS = 8000;
const SLOW_THRESHOLD_MS = 3000;

export async function probe(surface: Surface): Promise<ProbeResult> {
  const start = Date.now();
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(surface.healthUrl, {
      cache: "no-store",
      signal: ctrl.signal,
      headers: { "User-Agent": "afterroar-garmr/1.0" },
    });
    const latencyMs = Date.now() - start;
    let body: { status?: string } = {};
    try { body = await res.json(); } catch { /* health endpoint may not return JSON */ }

    if (res.status >= 200 && res.status < 300) {
      const status: ProbeStatus = body.status === "degraded"
        ? "degraded"
        : latencyMs > SLOW_THRESHOLD_MS
        ? "slow"
        : "healthy";
      return { surface, status, httpStatus: res.status, latencyMs, timestamp: Date.now() };
    }
    if (res.status === 503) {
      return { surface, status: "unhealthy", httpStatus: res.status, latencyMs, timestamp: Date.now() };
    }
    return {
      surface,
      status: "unreachable",
      httpStatus: res.status,
      latencyMs,
      detail: `HTTP ${res.status}`,
      timestamp: Date.now(),
    };
  } catch (err) {
    return {
      surface,
      status: "unreachable",
      httpStatus: null,
      latencyMs: Date.now() - start,
      detail: err instanceof Error ? err.message.slice(0, 200) : "fetch failed",
      timestamp: Date.now(),
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function probeAll(surfaces: Surface[]): Promise<ProbeResult[]> {
  return Promise.all(surfaces.map(probe));
}

/**
 * Coarse classification used for alerting + the overall-state badge.
 * Order: down > degraded > slow > healthy.
 */
export function aggregateStatus(results: ProbeResult[]): ProbeStatus {
  if (results.some((r) => r.status === "unreachable" || r.status === "unhealthy")) return "unreachable";
  if (results.some((r) => r.status === "degraded")) return "degraded";
  if (results.some((r) => r.status === "slow")) return "slow";
  return "healthy";
}

/**
 * "Down" for alerting purposes — these are the states that should fire a
 * notification + buzz. Slow/degraded are visible on screen but don't page.
 */
export function isDown(s: ProbeStatus): boolean {
  return s === "unreachable" || s === "unhealthy";
}
