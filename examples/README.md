# Example vulnerability projects

This directory contains intentionally vulnerable example projects for the ecosystems cvtree
supports.

- `npm-vuln/` - npm example using `lodash@4.17.15`
- `cargo-vuln/` - Cargo example using `time@0.1.44`
- `python-vuln/pip/` - requirements.txt example using `jinja2==2.11.3`
- `python-vuln/pip-tools/` - pip-tools example using `jinja2==2.11.3`
- `python-vuln/poetry/` - Poetry example using `jinja2==2.11.3`
- `python-vuln/pdm/` - PDM example using `jinja2==2.11.3`
- `python-vuln/uv/` - uv example using `jinja2==2.11.3`

These are intentionally vulnerable and intended as sample input for `cvtree audit` and `cvtree fix`.

Only the manifests are checked in. Lockfiles are generated, so they are gitignored here and you
produce them before auditing:

```bash
(cd examples/npm-vuln && npm install --package-lock-only)
(cd examples/python-vuln/poetry && poetry lock)
(cd examples/python-vuln/pdm && pdm lock)
(cd examples/python-vuln/uv && uv lock)
```

`cargo-vuln/` keeps its `Cargo.lock` because the pinned resolution is the point of the example.
`python-vuln/pip/` and `python-vuln/pip-tools/` need nothing generated: a `requirements.txt` of
`==` pins is already the lockfile.

Running `cvtree fix` against these will rewrite their manifests. Check them out again afterwards.
