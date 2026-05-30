/**
 * GET /api/memory/reflections?userId=...&includeSuperseded=true|false
 *
 * Returns derived (kind='derived' OR kind='extracted' with non-empty
 * `derivedFrom`) higher-order memories produced by reflect(), with
 * provenance pointers back to source memories.
 *
 * Walks the User scope via getAll() and filters client-side by
 * `metadata.derived_from`. Demonstrates the v0.4a reflection pipeline's
 * outputs as observable artifacts.
 */
import { NextRequest, NextResponse } from "next/server";
import { getMemory } from "@/lib/memory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const userId = url.searchParams.get("userId");
  if (userId === null || userId === "") {
    return NextResponse.json({ error: "userId required" }, { status: 400 });
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

  return NextResponse.json({ items: derived });
}
