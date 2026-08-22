# cvtree web

Next.js app for looking up a single package version. Convex caches the OSV results.

## Running it

```bash
npm install
npm run dev
```

Open http://localhost:3000 and search for `lodash@4.17.15`. The site queries OSV itself, so nothing
else needs to be running.

## API

The routes under `app/api/` query OSV and return normalized models. The OSV client, the CVSS scoring
and the normalization live in `lib/osv/`, the version resolution in `lib/registry.ts`, and the shared
types in `lib/model.ts`.

```
GET /api/search?q=lodash@4.17.15
GET /api/package/npm/lodash/4.17.15
GET /api/package/crates.io/time/0.1.44
GET /api/health
```

`/api/package` is a catch all, so scoped npm names work: `/api/package/npm/@babel/core/7.0.0`.

Without a version, the latest published version is resolved from registry.npmjs.org or crates.io and
returned in the response.

This code is a port of the Rust implementation in `cvtree/src/source/osv/`, and the two produce
identical JSON. Run `cvtree serve` alongside `npm run dev` and diff the two if you change either.

## Configuration

```bash
cp .env.example .env.local
```

`NEXT_PUBLIC_CONVEX_URL` turns on caching. Leave it empty and the app queries OSV on every search.

`OSV_API_URL`, `NPM_REGISTRY_URL` and `CRATES_REGISTRY_URL` override the upstream services and
default to the real ones. They exist so tests can point at a fixture server.

## Convex

Convex holds one table, `packages`, keyed by `ecosystem/name/version`. A search checks the cache
first, falls through to the Rust API on a miss or a stale entry, and writes the normalized result
back. Entries older than six hours are treated as misses.

`convex/_generated` is committed, so the app imports the typed `api` and typechecks without running
codegen first. Regenerate it with `npx convex dev` whenever you change the functions in `convex/`.

To point at your own deployment:

```bash
npx convex login
npx convex dev
```

That writes `NEXT_PUBLIC_CONVEX_URL` into `.env.local` and pushes the schema and functions.

To run Convex locally with no account at all, which is useful in CI or a sandbox:

```bash
CONVEX_AGENT_MODE=anonymous npx convex dev
```

That downloads a local backend and serves it on port 3210. The mode is in beta.

The cache reads and writes happen in the browser rather than in a Convex action, because actions run
on Convex's servers and cannot reach a Rust API on localhost.
