/**
 * GET /api/info → { backend: "pgvector" | "in-memory", reflectionThreshold: N }
 *
 * UI uses this to render a "Backend: pgvector / in-memory" badge and the
 * current reflection trigger.
 */
import { NextResponse } from "next/server";
import { getBackend } from "@/lib/memory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const backend = await getBackend();
  const raw = process.env.THEOMEM_REFLECTION_THRESHOLD ?? "10";
  const n = Number.parseInt(raw, 10);
  const reflectionThreshold = Number.isFinite(n) && n >= 0 ? n : 10;
  return NextResponse.json({ backend, reflectionThreshold });
}
