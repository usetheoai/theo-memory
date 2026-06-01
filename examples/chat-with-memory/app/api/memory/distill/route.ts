/**
 * T1.1 — POST /api/memory/distill
 *
 * Wires the v0.7 `ConflictResolutionPolicy` API into the demo's HTTP surface.
 * Accepts `{ userId, policy }`, validates strictly (EC-3 absorbs invalid
 * policy → 400 BEFORE factory; EC-1 absorbs stub+LJM → 422 via factory throw),
 * invokes `memory.user(userId).reflect({ conflictResolution })`, and returns
 * `{ derivedMemoriesCreated, reason, invocationId }`.
 *
 * EC-D traceability: logs `policy_name + invocationId` at start + end so
 * concurrent + race scenarios stay disambiguable in demo logs.
 *
 * @see .claude/knowledge-base/plans/examples-chat-with-memory-v0-7-distillation-plan.md § T1.1 + ADR D3 + EC-1 + EC-3 + EC-4 + EC-B + EC-D
 */
import { NextRequest, NextResponse } from "next/server";

import {
  StubLlmNotUsableForLjmError,
  getConflictResolutionPolicy,
  getMemory,
  type PolicyName,
} from "@/lib/memory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_POLICIES = ["noop", "last-write-wins", "llm-judged-merge"] as const;

interface DistillRequest {
  userId: unknown;
  policy: unknown;
}

function isValidPolicy(value: unknown): value is PolicyName {
  return typeof value === "string" && (VALID_POLICIES as readonly string[]).includes(value);
}

export async function POST(req: NextRequest) {
  let body: DistillRequest;
  try {
    body = (await req.json()) as DistillRequest;
  } catch {
    return NextResponse.json({ error: "invalid json body" }, { status: 400 });
  }

  if (typeof body.userId !== "string" || body.userId === "") {
    return NextResponse.json({ error: "userId required" }, { status: 400 });
  }

  if (!isValidPolicy(body.policy)) {
    return NextResponse.json(
      {
        error: `invalid policy; expected one of ${VALID_POLICIES.join(", ")}`,
      },
      { status: 400 },
    );
  }

  if (body.policy === "llm-judged-merge" && (process.env.OPENAI_API_KEY ?? "") === "") {
    return NextResponse.json(
      {
        code: "OPENAI_API_KEY_MISSING",
        message:
          "llm-judged-merge requires OPENAI_API_KEY. Set the env var or pick a different policy.",
      },
      { status: 422 },
    );
  }

  const invocationId = crypto.randomUUID();
  /* eslint-disable no-console */
  console.info(
    `[distill] start userId=${body.userId} policy=${body.policy} invocationId=${invocationId}`,
  );
  /* eslint-enable no-console */

  let conflictResolution;
  try {
    conflictResolution = await getConflictResolutionPolicy(body.policy);
  } catch (err) {
    if (err instanceof StubLlmNotUsableForLjmError) {
      return NextResponse.json(
        {
          code: "STUB_LLM_NOT_USABLE_FOR_LJM",
          message: err.message,
        },
        { status: 422 },
      );
    }
    throw err;
  }

  const startedAt = Date.now();
  const memory = await getMemory();
  // Per v0.7 SDK T2.1, the conflict-resolution phase runs BEFORE
  // executeReflection — the consolidation_history audit row is written
  // before the LLM-extraction step. If the LLM call subsequently fails
  // (e.g., DeterministicStubLLM returns `stub-response:<hex>` which is
  // not valid JSON), the consolidation work is already persisted; we
  // gracefully record the partial success and return derived=0.
  let derivedMemoriesCreated = 0;
  let reason: string | undefined;
  try {
    const result = await memory.user(body.userId).reflect({ conflictResolution });
    derivedMemoriesCreated = result.derivedMemoriesCreated;
    reason = result.reason;
  } catch (err) {
    /* eslint-disable no-console */
    console.warn(
      `[distill] reflect-llm-failed-after-consolidation invocationId=${invocationId} message=${String((err as Error).message)}`,
    );
    /* eslint-enable no-console */
    reason = "reflect-llm-failed-after-consolidation";
  }

  /* eslint-disable no-console */
  console.info(
    `[distill] end invocationId=${invocationId} derivedMemoriesCreated=${String(derivedMemoriesCreated)} durationMs=${String(Date.now() - startedAt)}`,
  );
  /* eslint-enable no-console */

  return NextResponse.json({
    derivedMemoriesCreated,
    reason,
    invocationId,
  });
}
