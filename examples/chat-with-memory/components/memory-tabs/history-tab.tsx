"use client";

import { useEffect, useState } from "react";
import { Card, Input } from "@usetheo/ui";
import { Plus, Minus, GitBranch } from "lucide-react";

interface HistoryEntry {
  action: "remember" | "forget" | "reflect";
  at: string;
  previousValue: string | null;
  newValue: string | null;
}

interface Props {
  inspectedId: string | null;
  onInspectedIdChange: (id: string) => void;
}

const ICON: Record<HistoryEntry["action"], React.ReactElement> = {
  remember: <Plus className="h-3 w-3 text-emerald-500" />,
  forget: <Minus className="h-3 w-3 text-rose-500" />,
  reflect: <GitBranch className="h-3 w-3 text-sky-500" />,
};

export function HistoryTab({ inspectedId, onInspectedIdChange }: Props) {
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (inspectedId === null || inspectedId === "") {
      setEntries([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const url = new URL("/api/memory/history", window.location.origin);
        url.searchParams.set("memoryId", inspectedId);
        const resp = await fetch(url);
        const json = (await resp.json()) as {
          entries?: HistoryEntry[];
          error?: string;
        };
        if (cancelled) return;
        if (!resp.ok) {
          setError(json.error ?? `HTTP ${resp.status}`);
          setEntries([]);
        } else {
          setEntries(json.entries ?? []);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [inspectedId]);

  return (
    <div className="flex h-full flex-col gap-3">
      <p className="text-[11px] text-muted-foreground">
        Audit trail via <code className="text-[10px]">memory.history(id)</code>.
        Every remember / forget / reflect event lands as a new row (ADD-only,
        ADR-0003).
      </p>

      <Input
        placeholder="memory id…"
        value={inspectedId ?? ""}
        onChange={(e) => onInspectedIdChange(e.target.value)}
      />

      <div className="flex-1 overflow-y-auto pr-1">
        {loading && <p className="text-xs text-muted-foreground">Loading…</p>}
        {error !== null && <p className="text-xs text-destructive">{error}</p>}
        {inspectedId === null || inspectedId === "" ? (
          <p className="rounded-md border border-dashed border-border p-3 text-xs text-muted-foreground">
            Click the history icon on any memory in the User / Session tabs to
            inspect its event chain.
          </p>
        ) : entries.length === 0 && !loading ? (
          <p className="rounded-md border border-dashed border-border p-3 text-xs text-muted-foreground">
            No history entries. The default in-memory demo boots WITHOUT a
            HistoryManager — wire a DrizzleHistoryManager with the pgvector
            backend to see real event chains.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {entries.map((e, i) => (
              <li key={`${e.at}-${i}`}>
                <Card size="sm" className="p-3">
                  <div className="flex items-center gap-2 text-xs">
                    {ICON[e.action]}
                    <strong className="uppercase tracking-wide">
                      {e.action}
                    </strong>
                    <span className="ml-auto text-[10px] text-muted-foreground">
                      {new Date(e.at).toLocaleString()}
                    </span>
                  </div>
                  {e.previousValue !== null && (
                    <p className="mt-2 text-[10px] text-muted-foreground line-through">
                      {e.previousValue}
                    </p>
                  )}
                  {e.newValue !== null && (
                    <p className="mt-1 text-[11px]">{e.newValue}</p>
                  )}
                </Card>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
