import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({
    ok: true,
    name: "themory-demo-chat",
    sdk: "@usetheo/sdk@1.3.0",
    memory: "@usetheo/memory (local workspace)",
    ui: "@usetheo/ui@0.12.0",
  });
}
