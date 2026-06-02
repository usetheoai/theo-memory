/**
 * GET /api/info → {
 *   backend: "pgvector" | "in-memory",
 *   reflectionThreshold: N,
 *   adapterSource: "stub" | "openai" | "local-openrouter",  // T2.2
 *   embedderDim: 384 | 1536                                  // T2.2
 * }
 *
 * UI uses this to render a "Backend: pgvector / in-memory" badge, the
 * current reflection trigger, and (adapters-or-local T2.2) the active
 * adapter source + embedder dim so operators can see at a glance which
 * mode the demo booted into.
 *
 * @see .claude/knowledge-base/plans/adapters-openrouter-local-embedder-plan.md § T2.2
 */
import { NextResponse } from "next/server";
import { getSingleton } from "@/lib/memory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const singleton = await getSingleton();
  const raw = process.env.THEOMEM_REFLECTION_THRESHOLD ?? "10";
  const n = Number.parseInt(raw, 10);
  const reflectionThreshold = Number.isFinite(n) && n >= 0 ? n : 10;
  return NextResponse.json({
    backend: singleton.backend,
    reflectionThreshold,
    adapterSource: singleton.adapterSource,
    embedderDim: singleton.embedderDim,
  });
}
