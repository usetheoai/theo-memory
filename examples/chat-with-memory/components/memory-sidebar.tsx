"use client";

import { useEffect, useState } from "react";
import { Badge, Sidebar, Tabs, Tooltip } from "@theokit/ui";
import { Brain } from "lucide-react";

import { apiCall } from "../lib/api-client";
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
    <Sidebar className="flex w-[400px] shrink-0 flex-col gap-3 border-l border-border p-4">
      <Sidebar.Header className="flex items-center gap-2 p-0">
        <Brain className="h-4 w-4 text-primary" />
        <h2 className="text-sm font-semibold">TheMemory</h2>
        {info !== null && (
          <div className="ml-auto flex items-center gap-1">
            <Tooltip
              label={
                info.backend === "pgvector"
                  ? "Persisting to Postgres + pgvector"
                  : "In-memory only — restarts wipe state"
              }
            >
              <Badge variant={info.backend === "pgvector" ? "success" : "warning"}>
                {info.backend}
              </Badge>
            </Tooltip>
            {info.adapterSource !== undefined && (
              <Tooltip
                label={`Adapter: ${info.adapterSource}${info.embedderDim !== undefined ? ` (${String(info.embedderDim)}-dim embedder)` : ""}`}
              >
                <Badge variant="primary">
                  {info.adapterSource}
                  {info.embedderDim !== undefined ? ` (${String(info.embedderDim)})` : ""}
                </Badge>
              </Tooltip>
            )}
          </div>
        )}
      </Sidebar.Header>

      <Tabs
        value={active}
        onValueChange={(v) => setActive(v as TabKey)}
        className="flex flex-1 flex-col gap-3 overflow-hidden"
      >
        <Tabs.List className="grid w-full grid-cols-6 gap-1 rounded-md bg-muted/50 p-1">
          {TABS.map((t) => (
            <Tabs.Trigger
              key={t.key}
              value={t.key}
              className="rounded px-2 py-1 text-xs font-medium text-muted-foreground transition data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm"
            >
              {t.label}
            </Tabs.Trigger>
          ))}
        </Tabs.List>

        <Tabs.Content value="user" className="flex-1 overflow-hidden">
          <UserTab
            userId={userId}
            reloadKey={reloadKey}
            onInspectHistory={handleInspect}
          />
        </Tabs.Content>
        <Tabs.Content value="session" className="flex-1 overflow-hidden">
          <SessionTab
            sessionId={sessionId}
            reloadKey={reloadKey}
            onInspectHistory={handleInspect}
          />
        </Tabs.Content>
        <Tabs.Content value="skills" className="flex-1 overflow-hidden">
          <SkillsTab defaultRepoId="repo-demo" />
        </Tabs.Content>
        <Tabs.Content value="history" className="flex-1 overflow-hidden">
          <HistoryTab
            inspectedId={inspectedId}
            onInspectedIdChange={setInspectedId}
          />
        </Tabs.Content>
        <Tabs.Content value="eviction" className="flex-1 overflow-hidden">
          <EvictionTab userId={userId} reloadKey={reloadKey} />
        </Tabs.Content>
        <Tabs.Content value="distillation" className="flex-1 overflow-hidden">
          <DistillationTab userId={userId} reloadKey={reloadKey} />
        </Tabs.Content>
      </Tabs>
    </Sidebar>
  );
}
