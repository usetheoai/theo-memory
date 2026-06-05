/**
 * GET /api/memory/reflections?userId=...
 *
 * Returns derived (kind='derived' OR derivedFrom non-empty) higher-order
 * memories produced by reflect(), with provenance. Walks scope.getAll()
 * and filters client-side. Migrated from app/api/memory/reflections/route.ts
 * (T2.1 of examples-theokit-chat-migration).
 */
import { defineRoute } from "theokit/server";
import { getMemory } from "@/lib/memory";

interface DerivedRow {
  id: string;
  text: string;
  createdAt: Date;
  derivedFrom: readonly string[];
  supersededBy: string | null;
  kind: string;
}

function asStringArray(value: unknown): readonly string[] {
  if (Array.isArray(value)) {
    return value.filter((v): v is string => typeof v === "string");
  }
  if (typeof value === "string") {
    try {
      const parsed: unknown = JSON.parse(value);
      if (Array.isArray(parsed)) {
        return parsed.filter((v): v is string => typeof v === "string");
      }
    } catch {
      return [];
    }
  }
  return [];
}

export const GET = defineRoute({
  handler: async ({ request }) => {
    const url = new URL(request.url);
    const userId = url.searchParams.get("userId");
    if (userId === null || userId === "") {
      return Response.json({ error: "userId required" }, { status: 400 });
    }

    const memory = await getMemory();
    const all = await memory.user(userId).getAll({ topK: 1000 });

    const derived: DerivedRow[] = [];
    for (const item of all) {
      const meta = item.metadata as Record<string, unknown>;
      const derivedFrom = asStringArray(meta["derived_from"]);
      const supersededBy =
        typeof meta["superseded_by"] === "string" ? meta["superseded_by"] : null;
      const kind = typeof meta["kind"] === "string" ? meta["kind"] : "extracted";
      if (derivedFrom.length > 0 || kind === "derived") {
        derived.push({
          id: item.id,
          text: item.text,
          createdAt: item.createdAt,
          derivedFrom,
          supersededBy,
          kind,
        });
      }
    }

    return Response.json({ items: derived });
  },
});
