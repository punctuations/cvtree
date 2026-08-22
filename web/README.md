# cvtree web

Next.js app for looking up a single package version. Convex caches the OSV results.

## Running it

The app calls the JSON API hosted by the cvtree binary, so start that first:

```bash
cargo run -- serve
```

Then:

```bash
npm install
npm run dev
```

Open http://localhost:3000 and search for `lodash@4.17.15`.

## Configuration

```bash
cp .env.example .env.local
```

`NEXT_PUBLIC_CVTREE_API` points at the Rust API and defaults to `http://localhost:8080`.

`NEXT_PUBLIC_CONVEX_URL` turns on caching. Leave it empty and the app queries the API directly on
every search, which is the fastest way to get the site running.

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
