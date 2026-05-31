/**
 * POST /api/memory/forget { userId, id, hard? }
 *
 * Default behavior (no `hard` field OR `hard: false`): soft-delete via
 * `t_invalid IS NOT NULL` per the v0.4b T7.1 BREAKING contract. The UI
 * `recall`/`list` paths filter on `t_invalid IS NULL` so the item disappears
 * from view; the row stays for audit + Show soft-deleted in the EvictionTab.
 *
 * Opt-in `{ hard: true }`: physical row removal (GDPR-style erasure). The row
 * is gone from the table entirely.
 *
 * T2.1: extends the request body with `hard?: boolean`; default unchanged.
 * EC-2 absorption: try/catch around the `memory.forget` call returns 500 JSON
 * rather than crashing the dev server when the backend rejects the call
 * (e.g., in-memory adapter that does not implement the option).
 *
 * @see .claude/knowledge-base/plans/examples-chat-with-memory-v0-4b-expansion-plan.md § T2.1 + ADR D2
 */
import { NextRequest, NextResponse } from "next/server";
import { getMemory } from "@/lib/memory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ForgetRequest {
  userId: string;
  id: string;
  hard?: boolean;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: ForgetRequest;
  try {
    body = (await req.json()) as ForgetRequest;
  } catch {
    return NextResponse.json({ error: "invalid json body" }, { status: 400 });
  }
  if (typeof body.userId !== "string" || body.userId === "") {
    return NextResponse.json({ error: "userId required" }, { status: 400 });
  }
  if (typeof body.id !== "string" || body.id === "") {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }
  if (body.hard !== undefined && typeof body.hard !== "boolean") {
    return NextResponse.json(
      { error: "hard must be boolean if provided" },
      { status: 400 },
    );
  }

  const memory = await getMemory();
  try {
    await memory.forget(body.id, body.hard === true ? { hard: true } : undefined);
  } catch (err) {
    return NextResponse.json(
      {
        error: "forget failed",
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
  return NextResponse.json({ ok: true });
}
