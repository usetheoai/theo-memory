/**
 * POST /api/memory/distill { userId, policy }
 *
 * Wires v0.7 ConflictResolutionPolicy into the demo HTTP surface. EC-3
 * (invalid policy → 400 BEFORE factory) + EC-1 (stub+LJM → 422 via factory
 * throw) + EC-B (OPENAI_API_KEY missing → 422 AFTER getSingleton env-shift)
 * absorbed inline. Migrated from app/api/memory/distill/route.ts
 * (T2.1 of examples-theokit-chat-migration).
 *
 * @see .claude/knowledge-base/plans/examples-chat-with-memory-v0-7-distillation-plan.md § T1.1 + ADR D3
 */
import { defineRoute } from "theokit/server";

import {
  StubLlmNotUsableForLjmError,
  getConflictResolutionPolicy,
  getMemory,
  type PolicyName,
} from "@/lib/memory";

const VALID_POLICIES = ["noop", "last-write-wins", "llm-judged-merge"] as const;

interface DistillRequest {
  userId: unknown;
  policy: unknown;
}

function isValidPolicy(value: unknown): value is PolicyName {
  return typeof value === "string" && (VALID_POLICIES as readonly string[]).includes(value);
}

export const POST = defineRoute({
  handler: async ({ request }) => {
    let body: DistillRequest;
    try {
      body = (await request.json()) as DistillRequest;
    } catch {
      return Response.json({ error: "invalid json body" }, { status: 400 });
    }

    if (typeof body.userId !== "string" || body.userId === "") {
      return Response.json({ error: "userId required" }, { status: 400 });
    }

    if (!isValidPolicy(body.policy)) {
      return Response.json(
        { error: `invalid policy; expected one of ${VALID_POLICIES.join(", ")}` },
        { status: 400 },
      );
    }

    // /review v0-7 F-Mi2: OPENAI_API_KEY check MUST run AFTER getSingleton()
    // because the singleton's env-shift promotes OPENROUTER_(API_)KEY →
    // OPENAI_API_KEY in local-openrouter mode.
    await getMemory();

    if (body.policy === "llm-judged-merge" && (process.env["OPENAI_API_KEY"] ?? "") === "") {
      return Response.json(
        {
          code: "OPENAI_API_KEY_MISSING",
          message:
            "llm-judged-merge requires OPENAI_API_KEY (or OPENROUTER_(API_)KEY in local-openrouter mode). Set the env var or pick a different policy.",
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
        return Response.json(
          { code: "STUB_LLM_NOT_USABLE_FOR_LJM", message: err.message },
          { status: 422 },
        );
      }
      throw err;
    }

    const startedAt = Date.now();
    const memory = await getMemory();
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

    return Response.json({ derivedMemoriesCreated, reason, invocationId });
  },
});
