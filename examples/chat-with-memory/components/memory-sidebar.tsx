"use client";

import { useEffect, useState } from "react";
import { Brain } from "lucide-react";

import { apiCall } from "@/lib/api-client";
import { UserTab } from "./memory-tabs/user-tab";
import { SessionTab } from "./memory-tabs/session-tab";
import { SkillsTab } from "./memory-tabs/skills-tab";
import { HistoryTab } from "./memory-tabs/history-tab";
import { EvictionTab } from "./memory-tabs/eviction-tab";
import { DistillationTab } from "./memory-tabs/distillation-tab";

type TabKey = "user" | "session" | "skills" | "history" | "eviction" | "distillation";

interface Props {
  userId: string;
  sessionId: string;
  reloadKey: number;
}

interface BackendInfo {
  backend: "pgvector" | "in-memory";
  reflectionThreshold: number;
  /** adapters-or-local T2.2 — additive field; may be absent on older API responses. */
  adapterSource?: "stub" | "openai" | "local-openrouter";
  /** adapters-or-local T2.2 — additive field; may be absent on older API responses. */
  embedderDim?: number;
}

const TABS: readonly { key: TabKey; label: string }[] = [
  { key: "user", label: "User" },
  { key: "session", label: "Session" },
  { key: "skills", label: "Skills" },
  { key: "history", label: "History" },
  { key: "eviction", label: "Eviction" },
  { key: "distillation", label: "Distillation" },
];

export function MemorySidebar({ userId, sessionId, reloadKey }: Props) {
  const [active, setActive] = useState<TabKey>("user");
  const [info, setInfo] = useState<BackendInfo | null>(null);
  const [inspectedId, setInspectedId] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const json = await apiCall<BackendInfo>("/api/info");
        setInfo(json);
      } catch {
        // info badge is purely informational; failure is non-fatal
      }
    })();
  }, []);

  const handleInspect = (memoryId: string) => {
    setInspectedId(memoryId);
    setActive("history");
  };

  return (
    <aside className="flex w-[400px] shrink-0 flex-col gap-3 border-l border-border p-4">
      <div className="flex items-center gap-2">
        <Brain className="h-4 w-4 text-primary" />
        <h2 className="text-sm font-semibold">TheMemory</h2>
        {info !== null && (
          <div className="ml-auto flex items-center gap-1">
            <span
              className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                info.backend === "pgvector"
                  ? "bg-emerald-500/20 text-emerald-700"
                  : "bg-amber-500/20 text-amber-700"
              }`}
              title={
                info.backend === "pgvector"
                  ? "Persisting to Postgres + pgvector"
                  : "In-memory only — restarts wipe state"
              }
            >
              {info.backend}
            </span>
            {info.adapterSource !== undefined && (
              <span
                className="rounded-full bg-blue-500/20 px-2 py-0.5 text-[10px] font-medium text-blue-700"
                title={`Adapter: ${info.adapterSource}${info.embedderDim !== undefined ? ` (${String(info.embedderDim)}-dim embedder)` : ""}`}
              >
                {info.adapterSource}
                {info.embedderDim !== undefined ? ` (${String(info.embedderDim)})` : ""}
              </span>
            )}
          </div>
        )}
      </div>

      <nav className="flex gap-1 rounded-md bg-muted/50 p-1">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setActive(t.key)}
            className={`flex-1 rounded px-2 py-1 text-xs font-medium transition ${
              active === t.key
                ? "bg-background shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {t.label}
          </button>
        ))}
      </nav>

      <div className="flex-1 overflow-hidden">
        {active === "user" && (
          <UserTab
            userId={userId}
            reloadKey={reloadKey}
            onInspectHistory={handleInspect}
          />
        )}
        {active === "session" && (
          <SessionTab
            sessionId={sessionId}
            reloadKey={reloadKey}
            onInspectHistory={handleInspect}
          />
        )}
        {active === "skills" && <SkillsTab defaultRepoId="repo-demo" />}
        {active === "history" && (
          <HistoryTab
            inspectedId={inspectedId}
            onInspectedIdChange={setInspectedId}
          />
        )}
        {active === "eviction" && (
          <EvictionTab userId={userId} reloadKey={reloadKey} />
        )}
        {active === "distillation" && (
          <DistillationTab userId={userId} reloadKey={reloadKey} />
        )}
      </div>
    </aside>
  );
}
