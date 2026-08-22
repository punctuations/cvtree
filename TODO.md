# TODO

Work left on the cvtree MVP, split by the two surfaces. The CLI track is Rust in `cvtree/` and
`cli/`. The web track is `web/`. The two are independent: the site queries OSV itself and does not
run any Rust, so a fix in one does not land in the other.

# CLI

## Tests

There are no audit-layer tests. The current tests cover lockfile parsing and OSV normalization, but
nothing covers the layer that joins them. The JSON schema is the contract other tools consume, and
right now a field rename would break it silently.

- [ ] Add a fake `VulnerabilitySource` and drive `audit_tree` with fixture vulnerabilities
- [ ] Assert severity counts and the `path` field on a report
- [ ] Assert `--fail-on` behaviour at each threshold, including nothing found
- [ ] Snapshot the `--json` output so the schema cannot change by accident
- [ ] Add `cli/tests` covering exit codes 0, 1 and 2
- [ ] Add an OSV fixture with `next_page_token` so the pagination loop is exercised

## Dependency tree

`--tree` prints each vulnerable package's path as a separate chain, so shared prefixes repeat and it
reads as noise. The parent and child edges are already in the arena and the data is correct. This is
the feature the project is named after.

- [ ] Merge the paths into one tree before rendering
- [ ] Draw it with proper prefixes so a shared parent appears once
- [ ] Decide whether `--tree` replaces the default output or stays a flag

## Ecosystem coverage

The web track now handles PyPI as well as npm and crates.io. The CLI does not, so `pip:` works on
the site and fails on the command line.

- [ ] Add PyPI to the Rust `Ecosystem` enum and registry client, matching the web track
- [ ] Parse `requirements.txt` and `poetry.lock`
- [ ] Parse `yarn.lock`
- [ ] Parse `pnpm-lock.yaml`
- [ ] Keep the `devDependencies` distinction from `package-lock.json` on the node
- [ ] Add an `--omit dev` option once dev dependencies are marked
- [ ] Score CVSS v4 vectors, which currently fall back to the advisory label or UNKNOWN
- [ ] Decide whether UNKNOWN severity should trip `--fail-on`, since today it never does

## Output

- [ ] Show every CVE alias in `search`, not the first one

An advisory can carry several CVE aliases. Printing only the first can put one identifier next to a
link for a different one, which happens today on lodash.

## Shipping

- [ ] Add a CI job running `cargo test`, `cargo clippy` and `cargo fmt --check`
- [ ] Publish an install path, either `cargo install` or release binaries

# Web

## Deep search

`/api/deepsearch` resolves a package's dependency tree from the registry and audits every package in
it. Ranges are resolved by `lib/semver.ts` and `lib/pep440.ts` rather than read from a lockfile, so
the answer is what a fresh install would get.

- [x] Give it a web view
- [ ] Decide whether the CLI grows the same thing for a package with no lockfile
- [ ] Put the deep search mode and depth in the URL, so a result can be shared
- [ ] Include npm `optionalDependencies`, or say why not
- [ ] Skip Cargo dependencies whose `target` cannot apply, instead of auditing all of them
- [ ] Evaluate PEP 508 markers rather than only dropping the ones naming an extra
- [ ] Report progress for a deep walk, which can take a while on a wide tree

## Trust

Every package in a deep search gets a score out of 4 from advisories per published version, drawn as
four twelve-stage boxes. The formula is in `lib/trust.ts` and the reasoning is in `web/README.md`.

- [ ] Decide whether the deep report caches trust separately, since advisory totals move faster than
      a package's dependency tree does
- [ ] Weight an advisory by severity, or decide the count alone is the honest signal
- [ ] Consider package age, since a package with 200 versions in a month is not the same as one with
      200 over ten years
- [ ] Show trust on the single package view, not only in deep search

## Convex

The deployment is local, so each developer runs their own backend and the cache is per machine. That
is fine for development and gives the team no shared benefit, so it is worth deciding early.

Caching now happens in the route handlers, so the API is cached and not just the browser. The
functions, the stored payload shape and the hit path are verified against a local backend: a cold
request writes and reports `x-cvtree-cache: miss`, the next one reports `hit` and returns the same
report, and eviction deletes stale rows and leaves fresh ones alone.

- [x] Confirm the cache hit path, end to end through the route handlers
- [ ] Decide whether to move to a cloud deployment so the cache is shared
- [x] Replace `report: v.any()` with a validator matching the normalized model
- [x] Stop the browser authoring cache entries
- [x] Evict rows past the TTL instead of leaving them in the table forever
- [x] Put a schema version in the cache key so a model change cannot serve old rows
- [ ] Confirm the browser read path in a real browser, not just the route handlers
- [ ] Decide what to do when a report is too large to store, beyond skipping the write

## Tests

`npm test` runs `node --test` with type stripping, so there is no framework to install. It covers the
range resolvers and nothing else. The CVSS scoring is still the piece most likely to drift silently.

- [x] Test the npm and Cargo range resolution in `lib/semver.ts`
- [x] Test the PEP 440 version and specifier handling in `lib/pep440.ts`
- [x] Test the trust scoring and the box stages in `lib/trust.ts`
- [ ] Test `cvssV3BaseScore` against known vectors, mirroring the Rust cases
- [ ] Test normalization against OSV fixtures: severity fallback, withdrawn, version lists, GIT ranges
- [ ] Test the query parser in `lib/spec.ts`
- [ ] Test the route handlers, including the 400, 404 and 502 paths
- [ ] Test the deep walk against a fixture registry: depth limits, cycles, the node cap, unresolved
- [ ] Test the cache fallthrough in `useLookup.ts`: hit, miss, and the deadline path when Convex is
      unreachable

## Product

The site only does single package search, and the tree has no web equivalent. Whether the site
should audit a whole project is a product decision rather than just work.

- [ ] Decide whether the site accepts a lockfile, by upload or paste
- [ ] Decide whether the tree gets a web view

## Interface

- [ ] Add an ecosystem selector, since today it is only the `npm:`, `cargo:` and `pip:` prefix syntax
- [ ] Put search state in the URL so a result can be shared and reloaded
- [ ] Add a light theme

## Reliability

The port did not carry over everything the Rust client does. These are gaps against the original,
not new ideas.

- [x] Add a timeout to the OSV and registry requests, since `fetch` has no default and the Rust
      client uses 30 seconds
- [ ] Make `/api/health` verify OSV is reachable, or rename it so it reads as a liveness check only
- [ ] Decide what protects OSV from repeated uncached searches, given the cache is optional

## Shipping

- [ ] Add a CI job running `npm test`, `tsc --noEmit`, `eslint` and `next build`. Nothing is
      prerendered against the network any more, so the build needs no OSV access.
- [ ] Deploy the site, which now needs nothing but network access to OSV

## Two implementations

The OSV client, the CVSS scoring and the normalization exist in Rust and in TypeScript. They produce
identical JSON today: `cvtree search <package> --json` and `GET /api/search?q=<package>` return the
same document. Nothing enforces that, so it will drift.

- [ ] Add a CI check that diffs `cvtree search --json` against `/api/search` on a fixed package set,
      comparing parsed JSON, since a cached response orders its keys differently
- [ ] Keep the normalized models in step whenever either side changes
- [ ] Revisit whether both implementations should exist at all once the CLI settles

# Order

On the CLI track, the audit and CLI tests come first, because they lock down the JSON contract and
the exit codes that CI usage depends on. Then the merged tree rendering. Then the extra lockfile
formats.

On the web track, confirm the cache path in the browser, then validate the cache writes, then decide
whether the site grows an audit view before spending time on interface polish.

The two tracks meet in one place now: any change to the normalized models, which both sides
implement separately. Adding an ecosystem to one and not the other is exactly the drift the "two
implementations" section warns about.
