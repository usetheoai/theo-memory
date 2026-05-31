# SEPA — Iteration 3 / Task T1.3 / Phase PRE-RED

**MODE:** TIGHT

## Findings
- [MAJOR] EC-1 absorption: `if (!userId) return` INSIDE useEffect, include userId in deps array.
- [MAJOR] Plan §344 requires 3 sections when enabled: (a) backend+trigger badges + max stat tile; (b) "Active rows: N / 10" + soft-deleted counter; (c) Show-soft-deleted toggle button. T1.2 endpoint does NOT return activeCount — need extension OR fetch /api/memory/recall.
- [MAJOR] Disabled hint copy LOCKED verbatim: "Set `THEOMEM_EVICTION_DEMO=1` to enable. See README § How to run."
- [MAJOR] Tab ordering: eviction AFTER history.
- [MINOR] No paper names in JSDoc.
- [INFO] RED n/a per ADR D5.
- [INFO] LoC budgets: eviction-tab.tsx ≤ 200; sidebar +10-15.

## Resolution
- Extend `/api/memory/eviction-status` to ALSO return `activeCount` (single COUNT WHERE t_invalid IS NULL). Small contract extension; H1 scenario requires it. Update route + tab in same iteration commit.

## Recommended action
- Update route.ts to return activeCount.
- Write eviction-tab.tsx with EC-1 guard + 3 sections + verbatim hint copy.
- Register tab in memory-sidebar.tsx after history.
- Bundle commit (T1.3 includes the route activeCount extension).
