# cvtree

Dependency vulnerability auditing backed by [OSV](https://osv.dev). Point it at a project and it tells
you which of your resolved dependencies have known vulnerabilities, and how the vulnerable ones got
there.

Two interfaces share one Rust implementation:

- `cvtree` on the command line, for auditing a project from its lockfile
- a web app for looking up a single package version

## Status

Working today: npm and crates.io, package search, lockfile auditing, human and JSON output,
severity based exit codes, and the web app. The dependency tree is parsed and stored (including
parent/child edges), and the audit reports the path that introduced each vulnerable package, but
`--tree` rendering is still rough.

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
```

Lockfiles only. `package.json` and `Cargo.toml` state ranges, not the versions you actually installed.

### Exit codes

```
0  cvtree ran, and nothing was found at or above --fail-on
1  a vulnerability at or above --fail-on was found
2  cvtree could not complete the request
```

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
GET /api/health
```

Errors come back as `{"error": "..."}` with a useful status: 400 for a bad package or ecosystem, 404
when a package has no published version to resolve, 502 when OSV cannot be reached.

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

Implement `DependencyParser` in `cvtree/src/parser/` and add it to `parser::all()`. It needs to detect
its lockfile and turn it into a `DependencyTree`. Nothing else changes.

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

- ecosystems other than npm and crates.io
- merged tree rendering, so shared paths are drawn once
- yarn.lock, pnpm-lock.yaml, npm workspaces beyond skipping linked packages
