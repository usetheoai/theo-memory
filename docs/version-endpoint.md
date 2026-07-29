# `GET /v1/version` — build provenance

A deployed image should be able to answer, without a credential, **which commit it
is running and when it was built**. That is what this endpoint is for.

```
GET /v1/version        (no authentication)

{
  "name":     "@usetheo/memory",
  "version":  "0.35.0",
  "git_sha":  "3dc878c…",
  "built_at": "2026-07-28T23:34:12Z",
  "node":     "v22.23.0"
}
```

Handler: `packages/api/src/server/handlers/version.ts` — 24 lines, no new dependency.
Registered in `packages/api/src/server/routes/register-routes.ts` alongside the
health pair, in the auth-exempt group.

## The three fields come from the environment

| Field | Environment variable | Fallback |
|---|---|---|
| `version` | `THEOMEM_VERSION` | `"dev"` |
| `git_sha` | `THEOMEM_GIT_SHA` | `"unknown"` |
| `built_at` | `THEOMEM_BUILD_TIME` | `"unknown"` |

`name` is the package identity and `node` is `process.version` — both are always
known, so neither has a fallback.

**The fallbacks are part of the contract, not defensive padding.** A consumer that
aggregates versions across services needs to distinguish *"it answered but does not
know what it is"* from *"it answered with a real version"*. Returning an empty
string, or omitting the field, collapses those two cases into one — and the reader
of that output will assume the request failed when in fact it succeeded.

## Why it is auth-exempt

A version endpoint exists so a caller can tell a **down** service from a **healthy**
one. Behind a credential, a service that is down and a credential that is wrong
produce the same response, and the caller cannot separate them.

The endpoint exposes the package name, the version, the build time and the commit.
It exposes no configuration, no tenant data, and no capability — asking it is not a
step toward anything.

## Wiring the provenance at deploy time (the part that rots)

The handler reads the environment. Something has to **write** it. The source of
truth is the OCI label the pipeline bakes into the image:

```
org.opencontainers.image.revision   →  THEOMEM_GIT_SHA
org.opencontainers.image.created    →  THEOMEM_BUILD_TIME
```

Deriving these from anything else — a `git rev-parse` on the deploy host, a
timestamp taken at container start — reports the *host's* state, not the image's.
Those two diverge exactly when it matters.

### The failure this endpoint has already had

When deployment moved from push to pull, the CI job that wrote these variables
stopped existing. Nothing replaced it. The container then ran **the new image while
reporting the old commit** — and because the image itself matched, no drift check
fired and nothing turned red.

A version endpoint that lies is worse than no endpoint, because it is what drift
checks and manual verification are built on. If your deployment converges by image,
it has to converge on **three** axes: the image, the running state (a stopped
container is not restarted by `restart: unless-stopped`), and the provenance.

## Verifying it

```bash
curl -s localhost:8080/v1/version | jq
```

Two checks worth making after any deployment change:

1. The `git_sha` matches the commit you believe is deployed. If it does not, the
   provenance wiring is broken even though the image may be correct.
2. With the service stopped, the request **fails** — it does not return a cached or
   hard-coded version from some other layer.
