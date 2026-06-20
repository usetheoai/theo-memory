# SEPA — T4.1 (iteration 6)
pre-RED (TIGHT): lastSeenAt=MAX(memories.created_at) via 3-table join (NOT entities.created_at first-write); COUNT(DISTINCT memory_id); GROUP BY e.id; WHERE COALESCE idiom byte-for-byte; all $N-bound; EntityNodeSummary on the DIP + barrel; real-pg test with ordering+distinct+scope-isolation.
post-GREEN (TIGHT): GREEN accepted. All (a)-(f) met; tests non-vacuous (count 2vs1, ordering, MAX picks 2026-06-03, scope isolation, empty []). No-paper-names clean. EntityNodeSummary re-exported via domain barrel.
