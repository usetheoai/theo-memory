/**
 * EvictionTab — surfaces the v0.4b capacity-trigger eviction pipeline state
 * for the queried `userId` scope. Conditional render (ADR D3):
 *   - `enabled: false` → hint card pointing at README.
 *   - `enabled: true`  → backend + trigger config + active-vs-cap progress +
 *                        soft-deleted counter + Show soft-deleted toggle.
 *
 * EC-1 absorption (plan §336): `userId` arrives via prop from
 * `MemorySidebar`; the fetch only fires when `userId` is truthy, so the
 * `eviction-status` endpoint never receives an empty `userId` and returns
 * 400 silently.
 *
 * @see .claude/knowledge-base/plans/examples-chat-with-memory-v0-4b-expansion-plan.md § T1.3
 */
"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, Card } from "@theokit/ui";
import { Database, RefreshCw, Snowflake } from "lucide-react";

import { apiCall, ApiError } from "../../lib/api-client";

interface EvictionStatus {
  enabled: boolean;
  trigger: "capacity" | "time" | null;
  maxMemoriesPerScope: number | null;
  activeCount: number;
  softDeletedCount: number;
}

interface Props {
  userId: string;
  reloadKey: number;
}

const DISABLED_HINT =
  "Set THEOMEM_EVICTION_DEMO=1 to enable. See README § How to run.";

export function EvictionTab({ userId, reloadKey }: Props) {
  const [status, setStatus] = useState<EvictionStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [showSoftDeleted, setShowSoftDeleted] = useState(false);

  const load = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    try {
      const json = await apiCall<EvictionStatus>("/api/memory/eviction-status", {
        query: { userId },
      });
      setStatus(json);
    } catch (err) {
      // theoFetch throws on non-2xx; keep prior behavior (null status disables UI).
      if (err instanceof ApiError) {
        setStatus(null);
      } else {
        throw err;
      }
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load, reloadKey]);

  if (status === null) {
    return (
      <Card className="border-dashed p-4 text-xs text-muted-foreground">
        {loading ? "Loading eviction status…" : DISABLED_HINT}
      </Card>
    );
  }

  if (!status.enabled) {
    return (
      <Card className="border-dashed p-4 text-xs text-muted-foreground">
        {DISABLED_HINT}
      </Card>
    );
  }

  const cap = status.maxMemoriesPerScope ?? 0;
  const pct =
    cap > 0 ? Math.min(100, Math.round((status.activeCount / cap) * 100)) : 0;

  return (
    <div className="flex flex-col gap-3">
      <Card className="flex items-center justify-between p-3 text-xs">
        <div className="flex items-center gap-2">
          <Database className="h-3 w-3 text-emerald-600" />
          <span className="font-medium">pgvector</span>
          <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
            {status.trigger}
          </span>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => void load()}
          disabled={loading}
        >
          <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
        </Button>
      </Card>

      <Card className="p-3 text-xs">
        <div className="mb-1 flex items-center justify-between">
          <span className="text-muted-foreground">Active rows</span>
          <span className="font-mono">
            {status.activeCount} / {cap}
          </span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full bg-emerald-500/70 transition-all"
            style={{ width: `${pct}%` }}
          />
        </div>
      </Card>

      <Card className="flex items-center justify-between p-3 text-xs">
        <div className="flex items-center gap-2">
          <Snowflake className="h-3 w-3 text-blue-600" />
          <span className="text-muted-foreground">Soft-deleted</span>
        </div>
        <span className="font-mono">{status.softDeletedCount}</span>
      </Card>

      <Button
        type="button"
        variant="secondary"
        size="sm"
        onClick={() => setShowSoftDeleted((v) => !v)}
      >
        {showSoftDeleted ? "Hide soft-deleted" : "Show soft-deleted"}
      </Button>

      {showSoftDeleted && (
        <Card className="border-dashed p-3 text-[10px] text-muted-foreground">
          Soft-deleted rows stay in the table with{" "}
          <code className="font-mono">t_invalid IS NOT NULL</code> per the
          v0.4b BREAKING contract. The list view ships in a future cycle; for
          now this tab surfaces the count only.
        </Card>
      )}
    </div>
  );
}
