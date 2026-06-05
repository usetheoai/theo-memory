"use client";

import { useEffect, useState } from "react";
import { Button, Card, Input } from "@usetheo/ui";
import { GitMerge, Plus, Trash2 } from "lucide-react";

import { apiCall, ApiError } from "@/lib/api-client";

interface SkillRow {
  id: string;
  description: string;
  code: string | null;
  codeLanguage: "typescript" | "javascript" | null;
  derivedFrom: readonly string[];
  supersededBy: string | null;
  createdAt: string;
  score?: number;
}

interface Props {
  defaultRepoId: string;
}

interface SkillDraftForm {
  description: string;
  code: string;
  codeLanguage: "typescript" | "javascript";
}

const DEFAULT_NEW_SKILL: SkillDraftForm = {
  description: "",
  code: "",
  codeLanguage: "typescript",
};

export function SkillsTab({ defaultRepoId }: Props) {
  const [repoId, setRepoId] = useState(defaultRepoId);
  const [items, setItems] = useState<SkillRow[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [draft, setDraft] = useState(DEFAULT_NEW_SKILL);
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [consolidating, setConsolidating] = useState(false);
  const [consolidateInfo, setConsolidateInfo] = useState<string | null>(null);

  const load = async (q = "") => {
    setLoading(true);
    try {
      const json = await apiCall<{ items: SkillRow[] }>("/api/skills", {
        query: { repoId, q: q === "" ? undefined : q },
      });
      setItems(json.items);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repoId]);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    setAdding(true);
    setAddError(null);
    try {
      await apiCall("/api/skills", { method: "POST", body: { repoId, ...draft } });
      setDraft(DEFAULT_NEW_SKILL);
      await load(query);
    } catch (err) {
      if (err instanceof ApiError) {
        const errBody = err.body as { error?: string } | null;
        setAddError(
          (errBody !== null && typeof errBody === "object" && typeof errBody.error === "string"
            ? errBody.error
            : null) ?? `HTTP ${err.status}`,
        );
      } else {
        setAddError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setAdding(false);
    }
  };

  const handleForget = async (skillId: string) => {
    await apiCall("/api/skills/forget", { method: "POST", body: { repoId, skillId } });
    await load(query);
  };

  const handleConsolidate = async () => {
    setConsolidating(true);
    setConsolidateInfo(null);
    try {
      const json = await apiCall<{
        sourceClustersCount?: number;
        derivedSkillsCount?: number;
        durationMs?: number;
      }>("/api/skills/consolidate", {
        method: "POST",
        // DEMO showcase tuning per plan ADR D1 (core ConsolidateOptions default is 0.85).
        body: { repoId, clusterThreshold: 0.6 },
      });
      setConsolidateInfo(
        `${json.derivedSkillsCount ?? 0} derived skill(s) produced from ${
          json.sourceClustersCount ?? 0
        } source cluster(s) in ${json.durationMs ?? 0}ms.`,
      );
      await load("");
    } catch (err) {
      if (err instanceof ApiError) {
        const errBody = err.body as { error?: string } | null;
        const detail =
          errBody !== null && typeof errBody === "object" && typeof errBody.error === "string"
            ? errBody.error
            : `HTTP ${err.status}`;
        setConsolidateInfo(`Error: ${detail}`);
      } else {
        setConsolidateInfo(`Error: ${err instanceof Error ? err.message : String(err)}`);
      }
    } finally {
      setConsolidating(false);
    }
  };

  return (
    <div className="flex h-full flex-col gap-3">
      <p className="text-[11px] text-muted-foreground">
        <strong>v0.6 RepoScope</strong> — code-as-skill procedural memory.
        Identity is <code className="text-[10px]">hashFact(description)</code>;
        same description + different code collide on UNIQUE.
      </p>

      <Input
        placeholder="repo-id (e.g. repo-payments)"
        value={repoId}
        onChange={(e) => setRepoId(e.target.value)}
      />

      <form
        onSubmit={handleAdd}
        className="flex flex-col gap-2 rounded-md border border-border p-3"
      >
        <p className="text-[11px] font-semibold uppercase text-muted-foreground">
          Add skill
        </p>
        <Input
          placeholder="description (semantic identity)"
          value={draft.description}
          onChange={(e) =>
            setDraft((d) => ({ ...d, description: e.target.value }))
          }
          required
        />
        <textarea
          placeholder="code snippet"
          value={draft.code}
          onChange={(e) => setDraft((d) => ({ ...d, code: e.target.value }))}
          rows={4}
          required
          className="rounded-md border border-input bg-background px-2 py-1 font-mono text-[11px]"
        />
        <select
          value={draft.codeLanguage}
          onChange={(e) =>
            setDraft((d) => ({
              ...d,
              codeLanguage: e.target.value as "typescript" | "javascript",
            }))
          }
          className="rounded-md border border-input bg-background px-2 py-1 text-xs"
        >
          <option value="typescript">typescript</option>
          <option value="javascript">javascript</option>
        </select>
        <Button type="submit" size="sm" disabled={adding}>
          <Plus className="mr-1 h-3 w-3" />
          {adding ? "Adding…" : "Add"}
        </Button>
        {addError !== null && (
          <p className="text-xs text-destructive">{addError}</p>
        )}
      </form>

      <Input
        placeholder="Recall by semantic query…"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          void load(e.target.value);
        }}
      />

      <Button
        variant="secondary"
        onClick={handleConsolidate}
        disabled={consolidating}
        className="w-full justify-start"
      >
        <GitMerge className="mr-2 h-4 w-4" />
        {consolidating ? "Consolidating…" : "Consolidate (4-phase orchestrator)"}
      </Button>
      {consolidateInfo !== null && (
        <p className="text-xs text-muted-foreground">{consolidateInfo}</p>
      )}

      <div className="flex-1 overflow-y-auto pr-1">
        <ul className="flex flex-col gap-2">
          {items.length === 0 && !loading && (
            <li className="rounded-md border border-dashed border-border p-3 text-xs text-muted-foreground">
              No skills in this repo yet. Add one above OR change the repoId.
            </li>
          )}
          {items.map((s) => (
            <li key={s.id}>
              <Card size="sm" className="p-3">
                <p className="text-xs leading-relaxed">{s.description}</p>
                {s.code !== null && (
                  <pre className="mt-2 overflow-x-auto rounded bg-muted/50 p-2 text-[10px] leading-snug">
                    <code>{s.code}</code>
                  </pre>
                )}
                {s.derivedFrom.length > 0 && (
                  <div className="mt-2 rounded bg-amber-500/10 px-2 py-1 text-[10px]">
                    <span className="font-semibold">derived_from:</span>{" "}
                    {s.derivedFrom.length} source(s)
                    <ul className="mt-1 font-mono">
                      {s.derivedFrom.map((id) => (
                        <li key={id} className="truncate">
                          ↳ {id}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {s.supersededBy !== null && (
                  <p className="mt-1 text-[10px] text-muted-foreground">
                    ⊘ superseded_by {s.supersededBy.slice(0, 8)}…
                  </p>
                )}
                <div className="mt-2 flex items-center justify-between text-[10px] text-muted-foreground">
                  <span>
                    {s.codeLanguage ?? "—"}
                    {" · "}
                    {s.score !== undefined
                      ? `score ${s.score.toFixed(2)}`
                      : new Date(s.createdAt).toLocaleString()}
                  </span>
                  <button
                    type="button"
                    onClick={() => void handleForget(s.id)}
                    className="rounded p-1 hover:bg-muted"
                    aria-label="Forget"
                    title="Forget (scope-isolated)"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
