"use client";

import { useEffect, useState } from "react";
import { Badge, Button, Card, EmptyState, Input, Timestamp } from "@theokit/ui";
import { History } from "lucide-react";

import { apiCall } from "../../lib/api-client";

interface MemoryRow {
  id: string;
  text: string;
  score?: number;
  createdAt: string;
}

interface Props {
  sessionId: string;
  reloadKey: number;
  onInspectHistory: (memoryId: string) => void;
}

export function SessionTab({ sessionId, reloadKey, onInspectHistory }: Props) {
  const [items, setItems] = useState<MemoryRow[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);

  const load = async (q = "") => {
    setLoading(true);
    try {
      const json = await apiCall<{ items: MemoryRow[] }>("/api/memory/session", {
        query: { sessionId, q: q === "" ? undefined : q },
      });
      setItems(json.items);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load(query);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, reloadKey]);

  return (
    <div className="flex h-full flex-col gap-3">
      <p className="text-[11px] text-muted-foreground">
        Mid-lived facts scoped to{" "}
        <strong className="break-all">session_id={sessionId}</strong>. This
        conversation only — open a new session to see the difference.
      </p>

      <Input
        placeholder="Filter session facts…"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          void load(e.target.value);
        }}
      />

      <div className="flex-1 overflow-y-auto pr-1">
        {loading && items.length === 0 && (
          <p className="text-xs text-muted-foreground">Loading…</p>
        )}
        <ul className="flex flex-col gap-2">
          {items.length === 0 && !loading && (
            <li>
              <EmptyState
                title="No session memories yet"
                description="Send a message — the agent stores facts into BOTH the User scope AND this Session scope."
                className="text-xs"
              />
            </li>
          )}
          {items.map((it) => (
            <li key={it.id}>
              <Card size="sm" className="p-3">
                <p className="text-xs leading-relaxed">{it.text}</p>
                <div className="mt-2 flex items-center justify-between text-[10px] text-muted-foreground">
                  {it.score !== undefined ? (
                    <Badge variant="outline">score {it.score.toFixed(2)}</Badge>
                  ) : (
                    <Timestamp value={it.createdAt} format="relative" />
                  )}
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => onInspectHistory(it.id)}
                    aria-label="Inspect history"
                    title="Inspect history"
                  >
                    <History className="h-3 w-3" />
                  </Button>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
