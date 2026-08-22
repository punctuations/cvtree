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

Set it up:

```bash
npx convex dev
```

That logs in, creates the deployment, writes `NEXT_PUBLIC_CONVEX_URL` into `.env.local`, and
generates `convex/_generated`. Until you run it, `convex/_generated` does not exist, which is why
`convex/` is excluded from the app's `tsconfig.json` and why `lib/convexFunctions.ts` addresses the
functions by name through `makeFunctionReference` instead of importing the generated `api`. Once
codegen has run you can switch those references over to `convex/_generated/api` for end to end types.

The cache reads and writes happen in the browser rather than in a Convex action, because actions run
on Convex's servers and cannot reach a Rust API on localhost.
