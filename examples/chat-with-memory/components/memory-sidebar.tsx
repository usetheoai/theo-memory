"use client";

import { useEffect, useState } from "react";
import { Button, Card, Input } from "@usetheo/ui";
import { Brain, RefreshCw, Sparkles, Trash2 } from "lucide-react";

interface MemoryRow {
  id: string;
  text: string;
  score?: number;
  createdAt: string;
}

interface Props {
  userId: string;
  reloadKey: number;
}

export function MemorySidebar({ userId, reloadKey }: Props) {
  const [items, setItems] = useState<MemoryRow[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [reflecting, setReflecting] = useState(false);
  const [reflectInfo, setReflectInfo] = useState<string | null>(null);

  const load = async (q = "") => {
    setLoading(true);
    try {
      const url = new URL("/api/memory/recall", window.location.origin);
      url.searchParams.set("userId", userId);
      if (q !== "") url.searchParams.set("q", q);
      const resp = await fetch(url);
      const json = (await resp.json()) as { items: MemoryRow[] };
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
    await fetch("/api/memory/forget", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, id }),
    });
    await load(query);
  };

  const handleReflect = async () => {
    setReflecting(true);
    setReflectInfo(null);
    try {
      const resp = await fetch("/api/memory/reflect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      });
      const json = (await resp.json()) as {
        derivedMemoriesCreated: number;
        reason?: string;
      };
      setReflectInfo(
        json.derivedMemoriesCreated > 0
          ? `Consolidated into ${json.derivedMemoriesCreated} higher-order fact(s).`
          : `No consolidation (reason: ${json.reason ?? "no source"}).`,
      );
      await load(query);
    } finally {
      setReflecting(false);
    }
  };

  return (
    <aside className="flex w-[360px] shrink-0 flex-col gap-3 border-l border-border p-4">
      <div className="flex items-center gap-2">
        <Brain className="h-4 w-4 text-primary" />
        <h2 className="text-sm font-semibold">TheMemory</h2>
        <span className="ml-auto text-xs text-muted-foreground">
          {items.length} fact(s)
        </span>
      </div>

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
                  <button
                    type="button"
                    onClick={() => void handleForget(it.id)}
                    className="rounded p-1 hover:bg-muted"
                    aria-label="Forget"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      </div>
    </aside>
  );
}
