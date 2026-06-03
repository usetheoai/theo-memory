# SEPA log — iteration 1 / T0.1 / pre-RED

**Mode:** TIGHT

**Findings:**
- [CRITICAL-1] MemorySingleton shape gap: doesn't expose llm + adapterSource. T0.1 MUST extend in same commit.
- [CRITICAL-2] EC-1 detection via adapterSource (resolveAdapters already returns source: 'stub'|'openai'), NOT constructor.name (fragile to minify/rename). KISS + Rule 9.
- [MAJOR-1] Lazy LJM instantiation discipline (ADR D5): only inside switch case branch.
- [MAJOR-2] PolicyName exhaustive guard: switch default → `const _: never = name`.

**Action:** RED test (a) extend MemorySingleton, (b) detect via adapterSource, (c) lazy LJM, (d) exhaustive guard.
