# SEPA — T4.2 (iteration 7)
post-GREEN (TIGHT): PASS to COMMIT. Shape held (id=name, +scope_type already present); fallback preserved (no regression); port rejection→500 via app.onError (honest fail-fast); wiring mirrors adminApi.pool (optional, backward-compat); DIP clean.
MINOR (guardrail, not blocking): two-path (port vs attributed_to fallback) is the planned Strangler-Fig seam (ADR D4) — acceptable transitional. When the port becomes the only path (entities populated everywhere), DELETE the fallback + attributedPeerOf import to avoid dead code.
