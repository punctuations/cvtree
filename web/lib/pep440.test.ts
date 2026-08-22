import assert from "node:assert/strict";
import { test } from "node:test";

import {
  comparePep440,
  maxSatisfyingPep440,
  parsePep440,
  parseRequirement,
  requiredWithoutExtras,
  satisfiesPep440,
} from "./pep440.ts";

const versions = [
  "1.0",
  "1.0.1",
  "1.1",
  "2.0",
  "2.0.1",
  "2.1",
  "2.2",
  "3.0",
  "3.0rc1",
  "3.1.dev1",
];

function parsed(input: string) {
  const value = parsePep440(input);
  assert.ok(value, `expected ${input} to parse`);
  return value;
}

test("parses epochs, pre, post and dev segments", () => {
  assert.deepEqual(parsePep440("1.2.3"), {
    epoch: 0,
    release: [1, 2, 3],
    pre: null,
    post: null,
    dev: null,
  });
  assert.deepEqual(parsePep440("2!1.0"), {
    epoch: 2,
    release: [1, 0],
    pre: null,
    post: null,
    dev: null,
  });
  assert.deepEqual(parsePep440("1.0rc2")?.pre, ["rc", 2]);
  assert.deepEqual(parsePep440("1.0a")?.pre, ["a", 0]);
  assert.deepEqual(parsePep440("1.0.post1")?.post, 1);
  assert.deepEqual(parsePep440("1.0.dev3")?.dev, 3);
  assert.equal(parsePep440("not-a-version"), null);
});

test("orders releases, prereleases and postreleases", () => {
  assert.ok(comparePep440(parsed("1.0"), parsed("1.0.1")) < 0);
  assert.ok(comparePep440(parsed("1.0rc1"), parsed("1.0")) < 0);
  assert.ok(comparePep440(parsed("1.0a1"), parsed("1.0b1")) < 0);
  assert.ok(comparePep440(parsed("1.0.dev1"), parsed("1.0rc1")) < 0);
  assert.ok(comparePep440(parsed("1.0"), parsed("1.0.post1")) < 0);
  assert.ok(comparePep440(parsed("1!1.0"), parsed("2.0")) > 0);
  assert.equal(comparePep440(parsed("1.0"), parsed("1.0.0")), 0);
});

test("matches the specifier operators", () => {
  assert.equal(satisfiesPep440(parsed("2.0"), ">=1.0"), true);
  assert.equal(satisfiesPep440(parsed("2.0"), ">=1.0,<2.0"), false);
  assert.equal(satisfiesPep440(parsed("1.5"), ">=1.0,<2.0"), true);
  assert.equal(satisfiesPep440(parsed("1.2.3"), "==1.2.*"), true);
  assert.equal(satisfiesPep440(parsed("1.3.0"), "==1.2.*"), false);
  assert.equal(satisfiesPep440(parsed("1.2.9"), "~=1.2.3"), true);
  assert.equal(satisfiesPep440(parsed("1.3.0"), "~=1.2.3"), false);
  assert.equal(satisfiesPep440(parsed("1.5.7"), "!=1.5.7,>=1.5.6"), false);
  assert.equal(satisfiesPep440(parsed("1.5.8"), "!=1.5.7,>=1.5.6"), true);
});

test("resolves the newest release, preferring finals over prereleases", () => {
  assert.equal(maxSatisfyingPep440(versions, ">=1.0"), "3.0");
  assert.equal(maxSatisfyingPep440(versions, ">=2.0,<3.0"), "2.2");
  assert.equal(maxSatisfyingPep440(versions, "<4,>=3.0"), "3.0");
  assert.equal(maxSatisfyingPep440(versions, ">=9.0"), null);
});

test("falls back to a prerelease when nothing else matches", () => {
  assert.equal(maxSatisfyingPep440(["1.0rc1", "1.0rc2"], ">=1.0rc1"), "1.0rc2");
});

test("an unconstrained requirement takes the newest final release", () => {
  assert.equal(maxSatisfyingPep440(versions, ""), "3.0");
  assert.equal(maxSatisfyingPep440(versions, "*"), "3.0");
});

test("parses PEP 508 requirement lines", () => {
  assert.deepEqual(parseRequirement("chardet (<4,>=3.0.2)"), {
    name: "chardet",
    specifier: "<4,>=3.0.2",
    extras: [],
    marker: null,
  });
  assert.deepEqual(parseRequirement("certifi (>=2017.4.17)")?.specifier, ">=2017.4.17");
  assert.deepEqual(parseRequirement("idna")?.specifier, "");
  assert.deepEqual(parseRequirement("requests[socks] >=2.0")?.extras, ["socks"]);
});

test("drops requirements that only apply to an extra", () => {
  const security = parseRequirement("pyOpenSSL (>=0.14) ; extra == 'security'");
  assert.ok(security);
  assert.equal(requiredWithoutExtras(security), false);

  const windows = parseRequirement(
    'win-inet-pton ; (sys_platform == "win32" and python_version == "2.7") and extra == \'socks\'',
  );
  assert.ok(windows);
  assert.equal(requiredWithoutExtras(windows), false);

  const plain = parseRequirement('urllib3 (<1.27,>=1.21.1) ; python_version >= "3"');
  assert.ok(plain);
  assert.equal(requiredWithoutExtras(plain), true);
});
