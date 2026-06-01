/**
 * DistillationTab — surfaces the v0.7 `ConflictResolutionPolicy` controls
 * for the queried `userId` scope. Three-radio policy selector
 * (noop / last-write-wins / llm-judged-merge per ADR D2) + "Distill now"
 * button + audit-row panel pulled from /api/memory/consolidation-history.
 *
 * Edge absorptions:
 *   - EC-5: AbortController in useEffect cleanup — when `userId` changes
 *     mid-fetch, stale results cannot overwrite current state.
 *   - EC-6: `disabled={loading}` covers both the inflight POST and the
 *     post-POST audit-list refresh — rapid double-clicks bounce off.
 *   - EC-1: 422 STUB_LLM_NOT_USABLE_FOR_LJM rendered with explicit
 *     guidance ("unset THEOMEM_USE_STUB_ADAPTERS"); distinct from
 *     OPENAI_API_KEY_MISSING (suggests setting the env var).
 *
 * @see .claude/knowledge-base/plans/examples-chat-with-memory-v0-7-distillation-plan.md § T2.1 + ADR D1 + D2
 * @see .claude/knowledge-base/reviews/examples-chat-with-memory-v0-7-distillation-edge-cases-2026-06-01.md § EC-1 + EC-5 + EC-6
 */
"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, Card } from "@usetheo/ui";
import { Beaker, RefreshCw } from "lucide-react";

type PolicyName = "noop" | "last-write-wins" | "llm-judged-merge";

interface AuditRow {
  readonly id: string;
  readonly kept_memory_id: string | null;
  readonly kept_memory_text: string | null;
  readonly rejected_memory_ids: readonly string[];
  readonly reason: string;
  readonly policy_name: string;
  readonly created_at: string;
}

interface AuditResponse {
  readonly rows: readonly AuditRow[];
  readonly total: number;
}

interface DistillResponse {
  readonly derivedMemoriesCreated?: number;
  readonly reason?: string;
  readonly invocationId?: string;
}

interface DistillError {
  readonly error?: string;
  readonly code?: string;
  readonly message?: string;
}

interface Props {
  readonly userId: string;
  readonly reloadKey: number;
}

const POLICY_LABELS: Record<PolicyName, string> = {
  noop: "Noop (DEFAULT — abstain; preserves ADD-only invariant)",
  "last-write-wins": "Last-Write-Wins (deterministic — pick most recent)",
  "llm-judged-merge": "LLM-Judged-Merge (one LLM call per cluster)",
};

const POLICY_VALUES: readonly PolicyName[] = [
  "noop",
  "last-write-wins",
  "llm-judged-merge",
];

function formatErrorBanner(err: DistillError): string {
  if (err.code === "OPENAI_API_KEY_MISSING") {
    return "OPENAI_API_KEY is not set. Either set the env var and restart, or pick a different policy.";
  }
  if (err.code === "STUB_LLM_NOT_USABLE_FOR_LJM") {
    return "Demo is running with THEOMEM_USE_STUB_ADAPTERS=1; the deterministic stub LLM cannot judge merges. Unset the env var and restart, or pick noop / last-write-wins.";
  }
  return err.error ?? err.message ?? "unknown error";
}

export function DistillationTab({ userId, reloadKey }: Props) {
  const [policy, setPolicy] = useState<PolicyName | null>(null);
  const [audit, setAudit] = useState<AuditResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  const [lastInvocation, setLastInvocation] = useState<string | null>(null);

  const loadAudit = useCallback(
    async (signal: AbortSignal): Promise<void> => {
      if (userId === "") return;
      const url = new URL("/api/memory/consolidation-history", window.location.origin);
      url.searchParams.set("userId", userId);
      url.searchParams.set("limit", "50");
      try {
        const resp = await fetch(url, { signal });
        if (!resp.ok) {
          setAudit({ rows: [], total: 0 });
          return;
        }
        const json = (await resp.json()) as AuditResponse;
        setAudit(json);
      } catch (err) {
        // Aborted fetch is expected control-flow (userId changed mid-fetch
        // OR component unmounted); swallow silently. Re-throw anything else.
        if (signal.aborted) return;
        if (err instanceof DOMException && err.name === "AbortError") return;
        throw err;
      }
    },
    [userId],
  );

  // EC-5: AbortController in cleanup — when `userId` (dep) changes,
  // the inflight fetch is aborted; stale results cannot overwrite state.
  useEffect(() => {
    const controller = new AbortController();
    void loadAudit(controller.signal);
    return () => {
      controller.abort();
    };
  }, [loadAudit, reloadKey]);

  const onDistill = useCallback(async () => {
    if (policy === null || userId === "") return;
    setLoading(true);
    setErrorBanner(null);
    try {
      const resp = await fetch("/api/memory/distill", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, policy }),
      });
      const json = (await resp.json()) as DistillResponse & DistillError;
      if (!resp.ok) {
        setErrorBanner(formatErrorBanner(json));
        return;
      }
      setLastInvocation(json.invocationId ?? null);
      // Reload audit list after a successful distill.
      const controller = new AbortController();
      await loadAudit(controller.signal);
    } finally {
      setLoading(false);
    }
  }, [policy, userId, loadAudit]);

  return (
    <div className="flex flex-col gap-3">
      <Card className="p-3 text-xs">
        <div className="mb-2 flex items-center gap-2">
          <Beaker className="h-3 w-3 text-purple-600" />
          <span className="font-medium">Pick a policy</span>
        </div>
        <div className="flex flex-col gap-1">
          {POLICY_VALUES.map((p) => (
            <label key={p} className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="distillation-policy"
                value={p}
                checked={policy === p}
                onChange={() => setPolicy(p)}
                disabled={loading}
                className="h-3 w-3"
              />
              <span className="text-[11px]">{POLICY_LABELS[p]}</span>
            </label>
          ))}
        </div>
        {/* EC-6: disabled={loading} covers double-click + post-POST refresh */}
        <Button
          type="button"
          variant="primary"
          size="sm"
          onClick={() => void onDistill()}
          disabled={loading || policy === null || userId === ""}
          className="mt-2 w-full"
        >
          {loading ? "Distilling…" : "Distill now"}
        </Button>
      </Card>

      {errorBanner !== null && (
        <Card className="border-red-300 bg-red-50 p-3 text-[11px] text-red-700">
          {errorBanner}
        </Card>
      )}

      {lastInvocation !== null && (
        <Card className="p-2 text-[10px] text-muted-foreground">
          Last invocationId: <code className="font-mono">{lastInvocation}</code>
        </Card>
      )}

      <Card className="p-3 text-xs">
        <div className="mb-2 flex items-center justify-between">
          <span className="font-medium">
            Consolidation history {audit !== null && `(${String(audit.total)})`}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              const controller = new AbortController();
              void loadAudit(controller.signal);
            }}
            disabled={loading}
          >
            <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>
        {audit === null ? (
          <div className="text-muted-foreground">Loading…</div>
        ) : audit.rows.length === 0 ? (
          <div className="text-muted-foreground">
            No consolidations yet. Seed 2 contradictory memories via the chat,
            pick a policy, click &quot;Distill now&quot;.
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {audit.rows.map((row) => (
              <li key={row.id} className="border-l-2 border-purple-300 pl-2">
                <div className="font-medium">
                  <span className="rounded-full bg-purple-500/15 px-1.5 py-0.5 text-[9px] font-medium text-purple-700">
                    {row.policy_name}
                  </span>
                </div>
                <div className="mt-1 text-[10px] text-muted-foreground">
                  Kept: <code>{row.kept_memory_text ?? "(orphan)"}</code>
                </div>
                <div className="text-[10px] text-muted-foreground">
                  Rejected ids: {row.rejected_memory_ids.length}
                </div>
                <div className="text-[10px] italic text-muted-foreground">
                  &quot;{row.reason}&quot;
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
