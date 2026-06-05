"use client";

import { useEffect, useState } from "react";
import { Button, Card, Input } from "@usetheo/ui";
import { History, RefreshCw, Sparkles, Trash2 } from "lucide-react";

import { apiCall } from "@/lib/api-client";

interface MemoryRow {
  id: string;
  text: string;
  score?: number;
  createdAt: string;
}

interface Props {
  userId: string;
  reloadKey: number;
  onInspectHistory: (memoryId: string) => void;
}

export function UserTab({ userId, reloadKey, onInspectHistory }: Props) {
  const [items, setItems] = useState<MemoryRow[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [reflecting, setReflecting] = useState(false);
  const [reflectInfo, setReflectInfo] = useState<string | null>(null);

  const load = async (q = "") => {
    setLoading(true);
    try {
      const json = await apiCall<{ items: MemoryRow[] }>("/api/memory/recall", {
        query: { userId, q: q === "" ? undefined : q },
      });
      setItems(json.items);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load(query);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, reloadKey]);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    await load(query);
  };

  const handleForget = async (id: string) => {
    await apiCall("/api/memory/forget", { method: "POST", body: { userId, id } });
    await load(query);
  };

  const handleReflect = async () => {
    setReflecting(true);
    setReflectInfo(null);
    try {
      const json = await apiCall<{ derivedMemoriesCreated: number; reason?: string }>(
        "/api/memory/reflect",
        { method: "POST", body: { userId } },
      );
      setReflectInfo(
        json.derivedMemoriesCreated > 0
          ? `Consolidated into ${json.derivedMemoriesCreated} higher-order fact(s).`
          : `No consolidation (reason: ${json.reason ?? "no source"}).`,
      );
      setQuery("");
      await load("");
    } finally {
      setReflecting(false);
    }
  };

  return (
    <div className="flex h-full flex-col gap-3">
      <p className="text-[11px] text-muted-foreground">
        Long-lived facts about <strong>user_id={userId}</strong>. Survive
        across sessions and page refreshes.
      </p>

      <form onSubmit={handleSearch} className="flex gap-2">
        <Input
          placeholder="Search facts…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <Button type="submit" variant="ghost" size="icon" disabled={loading}>
          <RefreshCw className={loading ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
        </Button>
      </form>

      <Button
        variant="secondary"
        onClick={handleReflect}
        disabled={reflecting}
        className="w-full justify-start"
      >
        <Sparkles className="mr-2 h-4 w-4" />
        {reflecting ? "Reflecting…" : "Run reflection (v0.4a)"}
      </Button>
      {reflectInfo !== null && (
        <p className="text-xs text-muted-foreground">{reflectInfo}</p>
      )}

      <div className="flex-1 overflow-y-auto pr-1">
        <ul className="flex flex-col gap-2">
          {items.length === 0 && !loading && (
            <li className="rounded-md border border-dashed border-border p-3 text-xs text-muted-foreground">
              No memories yet — the assistant will start remembering as you
              chat.
            </li>
          )}
          {items.map((it) => (
            <li key={it.id}>
              <Card size="sm" className="p-3">
                <p className="text-xs leading-relaxed">{it.text}</p>
                <div className="mt-2 flex items-center justify-between text-[10px] text-muted-foreground">
                  <span>
                    {it.score !== undefined
                      ? `score ${it.score.toFixed(2)}`
                      : new Date(it.createdAt).toLocaleString()}
                  </span>
                  <div className="flex gap-1">
                    <button
                      type="button"
                      onClick={() => onInspectHistory(it.id)}
                      className="rounded p-1 hover:bg-muted"
                      aria-label="Inspect history"
                      title="Inspect history"
                    >
                      <History className="h-3 w-3" />
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleForget(it.id)}
                      className="rounded p-1 hover:bg-muted"
                      aria-label="Forget"
                      title="Forget"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
