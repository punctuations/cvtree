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

## Convex

The deployment is local, so each developer runs their own backend and the cache is per machine. That
is fine for development and gives the team no shared benefit, so it is worth deciding early.

The functions and the stored payload shape are verified: a cold read returns null, the mutation
accepts a real normalized report, and the read returns it intact. The React wiring around them is
not verified.

- [ ] Confirm the cache hit path from the browser, not just through the functions
- [ ] Decide whether to move to a cloud deployment so the cache is shared
- [ ] Replace `report: v.any()` with a validator matching the normalized model
- [ ] Stop the browser authoring cache entries, or accept it and say so in the README
- [ ] Evict rows past the TTL instead of leaving them in the table forever
- [ ] Put a schema version in the cache key so a model change cannot serve old rows

## Tests

There are no JavaScript tests at all, and the OSV client, CVSS scoring and normalization now live
here as well as in Rust. The CVSS scoring is the piece most likely to drift silently.

- [ ] Test `cvssV3BaseScore` against known vectors, mirroring the Rust cases
- [ ] Test normalization against OSV fixtures: severity fallback, withdrawn, version lists, GIT ranges
- [ ] Test the query parser in `lib/spec.ts`
- [ ] Test the three route handlers, including the 400, 404 and 502 paths
- [ ] Test the cache fallthrough in `useLookup.ts`: hit, miss, and the deadline path when Convex is
      unreachable

## Product

The site does single package search and github repository search. The tree has no web equivalent.
Whether the site should audit a whole project is a product decision rather than just work.

- [ ] Decide whether the site accepts a lockfile, by upload or paste
- [ ] Decide whether the tree gets a web view

## Repository search

Repository search queries OSV over the `GIT` ecosystem and the github repository advisories
endpoint, then merges the two on GHSA id and CVE alias. It is web only, the CLI has no equivalent.

Without `GITHUB_TOKEN` the github side gets 60 requests an hour per IP, so on a deployed site that
source will be down for most visitors. The report says which source answered, and the merge falls
back to whichever one did.

- [ ] Set `GITHUB_TOKEN` wherever the site is deployed
- [ ] Cache repository reports, since they are not in the Convex package cache today
- [ ] Decide whether the CLI gets repository search too

## Interface

- [ ] Add an ecosystem selector, since today it is only the `npm:`, `cargo:` and `pip:` prefix syntax
- [ ] Put search state in the URL so a result can be shared and reloaded
- [ ] Add a light theme

## Reliability

The port did not carry over everything the Rust client does. These are gaps against the original,
not new ideas.

- [ ] Add a timeout to the OSV and registry requests, since `fetch` has no default and the Rust
      client uses 30 seconds
- [ ] Make `/api/health` verify OSV is reachable, or rename it so it reads as a liveness check only
- [ ] Decide what protects OSV from repeated uncached searches, given the cache is optional

## Shipping

- [ ] Add a CI job running `tsc --noEmit`, `eslint` and `next build`
- [ ] Deploy the site, which now needs nothing but network access to OSV

## Two implementations

The OSV client, the CVSS scoring and the normalization exist in Rust and in TypeScript. They produce
identical JSON today: `cvtree search <package> --json` and `GET /api/search?q=<package>` return the
same document. Nothing enforces that, so it will drift.

- [ ] Add a CI check that diffs `cvtree search --json` against `/api/search` on a fixed package set
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
