# cvtree

Dependency vulnerability auditing backed by [OSV](https://osv.dev). Point it at a project and it tells
you which of your resolved dependencies have known vulnerabilities, and how the vulnerable ones got
there.

Two interfaces share one Rust implementation:

- `cvtree` on the command line, for auditing a project from its lockfile
- a web app for looking up a single package version

## Status

Working today: npm, crates.io and PyPI, package search, lockfile auditing, automatic fixing, human
and JSON output, severity based exit codes, and the web app. The dependency tree is parsed and
stored (including parent/child edges), and the audit reports the path that introduced each
vulnerable package, but `--tree` rendering is still rough. The web app also audits a package's
transitive dependencies through `/api/deepsearch`.

## Layout

```
cvtree/   core library: lockfile parsing, the OSV client, normalized models, audit orchestration
cli/      the cvtree binary
web/      the Next.js web app, with Convex caching OSV results
```

The data flows one way, and each stage has its own module:

```
lockfile -> normalized dependencies -> vulnerability source -> normalized vulnerabilities -> output
```

## Command line

Build it:

```bash
cargo build --release
```

Look up one package version:

```bash
cvtree search lodash@4.17.15
cvtree search npm:express@4.17.1
cvtree search cargo:time@0.1.44
```

Without a version, cvtree resolves the latest published version from the registry (registry.npmjs.org
or crates.io) and tells you which version it used. A result is always about a specific version.

Audit a project:

```bash
cd my-project
cvtree audit
cvtree audit app/
cvtree audit --json
cvtree audit --fail-on high
```

Try to fix what it found:

```bash
cd my-project
cvtree fix
cvtree fix app/
cvtree fix --dry-run
cvtree fix --json
cvtree fix --yes
```

`cvtree fix` audits the project, picks the highest published fixed version for each vulnerable
package, writes that version into the manifest, and then re-runs the lock step. It asks once before
touching anything; `--yes` skips the question and a non-interactive run proceeds without asking.
`--dry-run` prints the plan to stdout and changes nothing.

Which manifest it writes, and what it runs after:

| Detected | Manifest written | Then runs |
| --- | --- | --- |
| `package-lock.json` | `package.json` | `npm install --package-lock-only` |
| `Cargo.lock` | `Cargo.toml` | `cargo update -p NAME --precise VERSION` |
| `poetry.lock` | `pyproject.toml` | `poetry lock` |
| `pdm.lock` | `pyproject.toml` | `pdm lock` |
| `uv.lock` | `pyproject.toml` | `uv lock` |
| `requirements.in` | `requirements.in` | `pip-compile --upgrade-package NAME==VERSION` |
| `requirements.txt` | `requirements.txt` | nothing, the pin is the fix |
| `pyproject.toml` | `pyproject.toml` | nothing, reinstall to pick it up |

A vulnerability in a package you did not ask for directly cannot be fixed by editing your own
dependency line, so cvtree pins it through whatever override mechanism the ecosystem has: the
`overrides` field for npm, `tool.pdm.resolution.overrides` for PDM, `tool.uv.override-dependencies`
for uv. Poetry has none, so the pin is added to `tool.poetry.dependencies` as a direct constraint
and cvtree says so.

Version ranges survive. `"^4.17.0"` becomes `"^4.17.21"`, not `"4.17.21"`.

The version chosen is the highest one OSV names as fixed, which is often a major version ahead of
what you have. Auditing an express 4 app produces express 5. Those upgrades are marked `breaking` in
the plan and in the JSON, and counted in a line of their own, so `--dry-run` shows them before
anything is written:

```
Found 7 vulnerable package(s) with a fix available.
  express 4.17.1 -> 5.0.0 (direct, breaking)
  qs 6.7.0 -> 6.14.2 (transitive)
  ...
6 of these cross a compatibility boundary and can break the build: body-parser, cookie, express, ...
```

An upgrade counts as breaking when the major version changes, or when the minor version changes
below 1.0, which is what Cargo and npm both treat as incompatible.

Advisories with no published fixed version are listed separately rather than dropped, since there is
nothing to upgrade to. A fix that the package manager rejects is reported per package with the
command that failed, and the run exits 1 with whatever did apply left in place.

Find nested projects without auditing them yet:

```bash
cvtree crawl app/
cvtree crawl app/ --stop=15
cvtree crawl app/ --json
```

`crawl` walks a directory tree, looks for the supported lockfiles, and stops after the optional
`--stop` count of directories scanned.

`audit` walks up from the given directory (default `.`) until it finds a supported lockfile:

Leak detection

`cvtree audit` can optionally run a lightweight leak-detection pass that scans project files for likely
API keys, private key headers, and other high-entropy tokens outside of `.env`. To enable it:

```bash
cvtree audit --leak
cvtree audit app/ --leak --json
```

If a `.env` file exists but `.gitignore` does not mention it, cvtree will warn about potential
sensitive data being committed.
```
package-lock.json
Cargo.lock
poetry.lock
pdm.lock
uv.lock
requirements.txt
pyproject.toml
```

Lockfiles first. `package.json` and `Cargo.toml` state ranges, not the versions you actually
installed, so they are never used as the source of truth. Python is the exception: a `requirements.txt`
of `==` pins is a lockfile in practice, and a `pyproject.toml` is the last resort for a project that
has no lock at all. Only `==` pins are read from either, because a range does not name a version to
check.

### Exit codes

```
0  cvtree ran, and nothing was found at or above --fail-on
1  a vulnerability at or above --fail-on was found
2  cvtree could not complete the request
```

For `cvtree fix`, 1 means some of the planned fixes could not be applied.

Without `--fail-on`, a run that finds vulnerabilities still exits 0, so `cvtree audit` stays
informational. Opt into failure in CI:

```yaml
- run: cvtree audit --fail-on high
```

Advisories with no severity rating never trip `--fail-on`. They are counted as UNKNOWN in the
report so you can still see them.

### JSON output

`cvtree audit --json` prints normalized models, not raw OSV responses:

```json
{
  "project": "demo-app",
  "ecosystem": "npm",
  "dependencies": 6,
  "vulnerable_dependencies": 6,
  "summary": { "critical": 1, "high": 4, "medium": 5, "low": 5, "unknown": 0 },
  "vulnerabilities": [
    {
      "package": "minimist",
      "version": "1.2.5",
      "ecosystem": "npm",
      "id": "GHSA-xvch-5gv4-984h",
      "aliases": ["CVE-2021-44906"],
      "severity": "CRITICAL",
      "cvss_score": 9.8,
      "summary": "Prototype Pollution in minimist",
      "fixed_versions": ["1.2.6", "0.2.4"],
      "affected": [{ "introduced": "1.0.0", "fixed": "1.2.6" }],
      "references": [{ "kind": "ADVISORY", "url": "https://nvd.nist.gov/vuln/detail/CVE-2021-44906" }],
      "path": ["demo-app", "minimist@1.2.5"]
    }
  ]
}
```

`path` is how the package entered the project, starting at the project itself.

## Web app

The site is self contained. Its route handlers query OSV directly and return the normalized models,
so nothing else needs to be running:

```bash
cd web && npm install && npm run dev   # http://localhost:3000
```

```
browser -> web/app/api/* -> OSV
```

The routes:

```
GET /api/search?q=lodash@4.17.15
GET /api/package/npm/lodash/4.17.15
GET /api/package/crates.io/time/0.1.44
GET /api/package/npm/@babel/core/7.0.0
GET /api/deepsearch?q=express@4.17.1&depth=2
GET /api/health
```

Errors come back as `{"error": "..."}` with a useful status: 400 for a bad package or ecosystem, 404
when a package has no published version to resolve, 502 when OSV cannot be reached.

`/api/deepsearch` goes past the one version you asked about. It resolves the package's dependencies
from the registry, then their dependencies, down to `depth` levels (default 2, maximum 6), and audits
every package it finds. The response is the same report `cvtree audit --json` produces, so each
finding carries the `path` it came in through:

```json
{
  "package": "lodash.template",
  "version": "3.6.2",
  "id": "GHSA-35jh-r3h4-6jhm",
  "severity": "HIGH",
  "path": ["gulp@3.9.1", "gulp-util@3.0.8", "lodash.template@3.6.2"]
}
```

There is no lockfile involved, so ranges are resolved the way a fresh install would resolve them.
`web/README.md` says what each ecosystem contributes and what is skipped.

Every package in the tree also gets a trust score out of 4, from how many advisories have ever been
filed against it over how many versions it has published. Four advisories across four releases reads
worse than forty across four hundred. The site draws it as four boxes that run green to yellow to
black, and the JSON carries it in `packages`.

Deep search is web only. On the command line `cvtree audit` already walks the whole tree, because a
lockfile already lists the transitive dependencies.

The OSV client, the CVSS scoring and the normalization exist twice, once in Rust and once in
TypeScript, and they produce identical JSON. `cvtree search <package> --json` and
`GET /api/search?q=<package>` return the same document, which is how the port is checked against the
original.

See `web/README.md` for the Convex cache setup.

## Severity

OSV does not hand out a single severity field. cvtree derives one, in this order:

1. the CVSS v3 vector in `severity[].score`, scored with the CVSS 3.1 base formula, then mapped
   to LOW / MEDIUM / HIGH / CRITICAL
2. the advisory's own label in `database_specific.severity` (GitHub's MODERATE becomes MEDIUM)
3. otherwise UNKNOWN

Withdrawn advisories are dropped.

## Adding another ecosystem

Implement `DependencyParser` in `cvtree/src/parser/` and add it to `parser::all()`. It needs to name
its lockfiles through `lockfiles()` and turn one into a `DependencyTree`. A parser can claim several
filenames, the way the Python one claims five, and `detected_lockfile()` reports which one was found.

To make `cvtree fix` work for it as well, add an arm to `fix_python`'s sibling dispatch in
`cli/src/main.rs`, keyed on the ecosystem. The shape is the same every time: write the version into
the manifest, then run the lock step.

Another vulnerability source implements `VulnerabilitySource`. OSV lives behind that trait, so its
JSON never leaves `cvtree/src/source/osv/`.

## Tests

```bash
cargo test
```

Tests never hit the network. The OSV fixtures in `cvtree/tests/fixtures/osv/` are real captured API
responses plus a hand written file covering severity fallbacks, withdrawn advisories and version
lists.

## Not done yet

- ecosystems other than npm, crates.io and PyPI
- merged tree rendering, so shared paths are drawn once
- yarn.lock, pnpm-lock.yaml, npm workspaces beyond skipping linked packages
- picking the lowest fix that clears an advisory, so `cvtree fix` can suggest a major bump
