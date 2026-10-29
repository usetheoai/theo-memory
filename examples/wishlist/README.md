# Exact wishlist records with durable contextual memory

This example uses one Postgres database with separate application and memory tables. The
application writes a wishlist item by exact ID. A background worker extracts preferences;
a later process loads the exact record and relevant memory together.

From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm build
docker compose -f examples/wishlist/compose.yaml up -d --wait
export THEOMEM_MIGRATE_PG_URI=postgresql://themem:themem@127.0.0.1:55440/themem_wishlist
export THEOMEM_PG_URI=postgresql://themory_app:themory_app@127.0.0.1:55440/themem_wishlist
export THEOMEM_WORKER_PG_URI=postgresql://themory_worker:themory_worker@127.0.0.1:55440/themem_wishlist
export THEOMEM_EMBEDDER=local
node examples/wishlist/setup.mjs
node examples/wishlist/run.mjs enqueue
# Configure OPENAI_API_KEY, OPENAI_BASE_URL and OPENAI_CHAT_MODEL for your provider.
node dist/agent-tools/cli.js worker --once
node examples/wishlist/run.mjs context
node examples/wishlist/run.mjs temporary
# Context shows the temporary invitation until its explicit 60-second deadline.
node examples/wishlist/run.mjs context
```

The local embedder downloads its model on first use. Alternatively select `openai` before
setup to use the OpenAI embedder and a 1536-dimensional schema. Do not change dimensions
on a database containing data you need to retain.

Repeat `enqueue` with the same input: it returns the same job. It does not create another
memory assertion. `context` never substitutes a similar memory for `missing-jacket`.
`facts.mjs` binds workspace and user outside the tool arguments and uses parameterized SQL.
In an application, derive that identity from authentication; this example uses Alice explicitly.

All credentials above are local development defaults. The server and worker application
connections use roles subject to RLS; the migration credential is used only by setup.
Stop the example with `docker compose -f examples/wishlist/compose.yaml down`.
