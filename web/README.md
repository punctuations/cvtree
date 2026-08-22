# cvtree web

Next.js app for looking up a single package version. Convex caches the OSV results.

## Running it

```bash
npm install
npm run dev
```

Open http://localhost:3000 and search for `lodash@4.17.15`. The site queries OSV itself, so nothing
else needs to be running.

Tick "Deep search" under the box to audit the dependency tree instead of the one version, and pick
how many levels to walk. The deep view lists every package in the tree with its trust meter, worst
first, then the findings with the path each one came in through.

## API

The routes under `app/api/` query OSV and return normalized models. The OSV client, the CVSS scoring
and the normalization live in `lib/osv/`, the version resolution in `lib/registry.ts`, and the shared
types in `lib/model.ts`.

```
GET /api/search?q=lodash@4.17.15
GET /api/package/npm/lodash/4.17.15
GET /api/package/crates.io/time/0.1.44
GET /api/deepsearch?q=express@4.17.1&depth=2
GET /api/health
```

`/api/package` is a catch all, so scoped npm names work: `/api/package/npm/@babel/core/7.0.0`.

Without a version, the latest published version is resolved from registry.npmjs.org, crates.io or
PyPI and returned in the response.

This code is a port of the Rust implementation in `cvtree/src/source/osv/`, and the two produce
identical JSON. `cvtree search lodash@4.17.15 --json` and `/api/search?q=lodash@4.17.15` return the
same document, so diff them if you change either side. Compare parsed JSON rather than bytes: a
response served from the Convex cache carries the same fields with the keys in a different order.

## Deep search

`/api/deepsearch` audits a package's dependencies and their dependencies, not just the one version
you asked about. It resolves the tree from the registry, then asks OSV about every package in it.

```
GET /api/deepsearch?q=express@4.17.1
GET /api/deepsearch?q=gulp@3.9.1&depth=2
GET /api/deepsearch?q=cargo:time@0.1.44&depth=3
GET /api/deepsearch?q=pip:requests@2.25.0
```

`depth` is how many levels below the root to walk, default 2, clamped to 6. Depth 0 audits only the
package itself. The walk stops at 400 unique packages and sets `truncated` when it does.

Deep search takes a package, not a repository. A repository query such as `axios/axios` is a 400
here, because the walk starts from a resolved package version and a repository does not have one.
Repository search is `/api/search` and `/api/repo`.

The response is the audit report the CLI produces, with the root package in place of the project and
three extra fields:

```json
{
  "package": "gulp",
  "version": "3.9.1",
  "ecosystem": "npm",
  "depth": 2,
  "requested_depth": 2,
  "dependencies": 56,
  "vulnerable_dependencies": 2,
  "summary": { "critical": 0, "high": 2, "medium": 0, "low": 0, "unknown": 0 },
  "max_severity": "HIGH",
  "truncated": false,
  "unresolved": [],
  "vulnerabilities": [
    {
      "package": "lodash.template",
      "version": "3.6.2",
      "ecosystem": "npm",
      "id": "GHSA-35jh-r3h4-6jhm",
      "severity": "HIGH",
      "path": ["gulp@3.9.1", "gulp-util@3.0.8", "lodash.template@3.6.2"]
    }
  ]
}
```

`depth` is the deepest level that actually had packages in it, which can be lower than
`requested_depth` when the tree runs out first. `path` starts at the root package, so a finding with
more than two entries came in through a dependency of a dependency.

`unresolved` lists requirements the walk could not turn into a version, with the reason. A dependency
that cannot be resolved is reported there instead of failing the whole request. A root package or
version that does not exist is a 404.

The response also carries a `packages` array, one entry per package in the tree, holding the trust
score described below.

## Trust

Trust asks a different question from the vulnerability list. The list says what is wrong with the
version you are on. Trust says how often this package has needed a security fix at all, relative to
how much it has shipped:

```
ratio = advisories ever filed against the package / versions it has published
trust = 4 * (1 - min(ratio, 0.5) / 0.5)
```

Four advisories over four releases is a worse sign than forty over four hundred, and the score says
so. It runs 0 to 4 with two decimals, and a ratio at or past one advisory per two releases scores 0.
A package with no published versions we can count is `null`, reported as unrated rather than as
either extreme.

Real numbers from `express@4.17.1` at depth 2:

| Package | Advisories | Versions | Trust |
| --- | --- | --- | --- |
| forwarded@0.2.0 | 1 | 4 | 2.00 |
| path-to-regexp@0.1.7 | 5 | 73 | 3.45 |
| qs@6.7.0 | 7 | 149 | 3.62 |
| vary@1.1.2 | 0 | 7 | 4.00 |

`qs` scores above `path-to-regexp` despite carrying more advisories, because it has published far
more often. That is the intent.

The advisory totals come from one extra OSV batch query per request, asking about each package with
no version pinned, so it counts every advisory ever filed rather than only the ones that hit the
version in the tree. Version counts come from the registry documents the walk already fetched.

The score is a shape-of-history signal, not a verdict. A package can score 4 and still ship a
critical vulnerability tomorrow, and a much-audited package can score low precisely because people
look at it.

### The meter

`components/TrustMeter.tsx` draws the score as four boxes, one per point. Each box has twelve stages,
so a box fills in twelfths and the score reads to a decimal. A full box is green, a half box yellow,
an empty box near black, with the ramp interpolated between:

```
4.00  [12] [12] [12] [12]   all green
3.86  [12] [12] [12] [10]   last box green-ish
3.50  [12] [12] [12] [ 6]   last box yellow
2.00  [12] [12] [ 0] [ 0]   two green, two black
1.19  [12] [ 2] [ 0] [ 0]
0.00  [ 0] [ 0] [ 0] [ 0]   all black
```

### How the tree is resolved

There is no lockfile here, so cvtree resolves ranges the way the ecosystem would, and the result is
what you would get from a fresh install rather than what any particular machine has on disk:

| Ecosystem | Source | Included |
| --- | --- | --- |
| npm | the abbreviated packument, `dependencies` per version | runtime dependencies |
| crates.io | `/crates/{name}/{version}/dependencies` | `normal` kind, not optional |
| PyPI | `info.requires_dist` | requirements whose marker does not name an extra |

Range resolution lives in `lib/semver.ts` (npm and Cargo) and `lib/pep440.ts` (PyPI). Cargo treats a
bare `1.2.3` as `^1.2.3` and npm treats it as an exact pin, which is the `caretDefault` argument.
npm dev dependencies are not published in the packument, so they are never walked. Cargo dev and
build dependencies are skipped; target-specific ones are kept, so a Windows-only dependency is
audited on any platform.

## Configuration

```bash
cp .env.example .env.local
```

`NEXT_PUBLIC_CONVEX_URL` turns on caching. Leave it empty and the app queries OSV on every search.
`CONVEX_URL` overrides it for the server side alone.

`OSV_API_URL`, `NPM_REGISTRY_URL`, `CRATES_REGISTRY_URL` and `PYPI_REGISTRY_URL` override the
upstream services and default to the real ones. They exist so tests can point at a fixture server.

## Convex

Two tables. `packages` holds single package reports, `deepReports` holds deep search results keyed by
depth as well. Both are keyed by a string that starts with the cache schema version, so changing the
normalized model means bumping `CACHE_SCHEMA_VERSION` in `convex/cache.ts` and old rows stop being
read.

```
v3:npm/lodash/4.17.15
v3:deep:npm/gulp/3.9.1:d2
```

The route handlers do the caching, in `lib/cache.ts`. A request checks the cache, falls through to
OSV on a miss, and writes the result back. Entries older than six hours are treated as misses, and an
hourly cron in `convex/crons.ts` deletes them. The browser reads the cache too, for a quicker first
paint, but it no longer writes: one writer means one key format. If Convex is unreachable the routes
still answer from OSV.

Every response carries `x-cvtree-cache`, which is `hit`, `miss`, `off` when no deployment is
configured, or `too-large` when a report is over the Convex document limit and was not stored.

The stored payload is validated. `convex/validators.ts` holds validators matching the normalized
model, and the functions apply them on the way in and on the way out: `put` validates its `report`
argument, `get` validates what it returns. A field rename fails the write rather than quietly storing
a shape nothing can read.

The validators are deliberately not on the table columns. A table validator is checked against every
existing row at deploy time, so one shape change would refuse to deploy until someone manually
emptied a cache that is disposable by definition. Rows from an older cache schema are unreadable
anyway, because the key carries the version, and the hourly eviction deletes them along with the
expired ones. Change the model, bump the version, and the old rows clean themselves up.

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

## Tests

```bash
npm test
```

`node --test` with type stripping, so there is no test framework to install. The suites cover the
range resolvers in `lib/semver.ts` and `lib/pep440.ts`, which is where a wrong answer turns into a
wrong dependency tree, and the scoring in `lib/trust.ts`. The OSV client, the CVSS scoring and the
route handlers are still untested.
