import assert from "node:assert/strict";
import { test } from "node:test";

import { compareSemVer, maxSatisfying, parseSemVer, satisfies } from "./semver.ts";

const versions = [
  "0.0.8",
  "0.5.0",
  "1.0.0",
  "1.2.3",
  "1.2.5",
  "1.2.8",
  "1.3.0",
  "2.0.0",
  "2.0.0-rc.1",
  "2.1.4",
  "3.0.0",
];

function parsed(input: string) {
  const value = parseSemVer(input);
  assert.ok(value, `expected ${input} to parse`);
  return value;
}

test("parses versions with missing components", () => {
  assert.deepEqual(parseSemVer("1"), { major: 1, minor: 0, patch: 0, prerelease: [] });
  assert.deepEqual(parseSemVer("1.2"), { major: 1, minor: 2, patch: 0, prerelease: [] });
  assert.deepEqual(parseSemVer("v1.2.3"), { major: 1, minor: 2, patch: 3, prerelease: [] });
  assert.deepEqual(parseSemVer("1.2.3+build.7"), {
    major: 1,
    minor: 2,
    patch: 3,
    prerelease: [],
  });
  assert.equal(parseSemVer("not-a-version"), null);
});

test("orders prereleases below their release", () => {
  assert.ok(compareSemVer(parsed("2.0.0-rc.1"), parsed("2.0.0")) < 0);
  assert.ok(compareSemVer(parsed("2.0.0-alpha"), parsed("2.0.0-beta")) < 0);
  assert.ok(compareSemVer(parsed("2.0.0-rc.2"), parsed("2.0.0-rc.10")) < 0);
  assert.equal(compareSemVer(parsed("1.2.3"), parsed("1.2.3")), 0);
});

test("caret ranges stay inside the leftmost non-zero component", () => {
  assert.equal(maxSatisfying(versions, "^1.2.3", false), "1.3.0");
  assert.equal(maxSatisfying(versions, "^0.0.8", false), "0.0.8");
  assert.equal(maxSatisfying(["0.5.0", "0.5.6", "0.6.0"], "^0.5.0", false), "0.5.6");
});

test("tilde ranges stay inside the minor", () => {
  assert.equal(maxSatisfying(versions, "~1.2.3", false), "1.2.8");
  assert.equal(maxSatisfying(versions, "~1", false), "1.3.0");
});

test("x-ranges and wildcards", () => {
  assert.equal(maxSatisfying(versions, "1.2.x", false), "1.2.8");
  assert.equal(maxSatisfying(versions, "1.x", false), "1.3.0");
  assert.equal(maxSatisfying(versions, "*", false), "3.0.0");
  assert.equal(maxSatisfying(versions, "", false), "3.0.0");
});

test("comparator sets, unions and hyphen ranges", () => {
  assert.equal(maxSatisfying(versions, ">=1.0.0 <2.0.0", false), "1.3.0");
  assert.equal(maxSatisfying(versions, ">= 1.0.0 < 2.0.0", false), "1.3.0");
  assert.equal(maxSatisfying(versions, "1.2.3 - 2.0.0", false), "2.0.0");
  assert.equal(maxSatisfying(versions, "^1.0.0 || ^3.0.0", false), "3.0.0");
  assert.equal(maxSatisfying(versions, ">=0.5 0", false), "0.5.0");
});

test("an exact version is exact for npm and a caret for cargo", () => {
  assert.equal(maxSatisfying(versions, "1.2.3", false), "1.2.3");
  assert.equal(maxSatisfying(versions, "1.2.3", true), "1.3.0");
  assert.equal(maxSatisfying(versions, "=1.2.3", true), "1.2.3");
});

test("prereleases are excluded unless the range names one", () => {
  assert.equal(maxSatisfying(versions, ">=1.0.0", false), "3.0.0");
  assert.equal(satisfies(parsed("2.0.0-rc.1"), ">=1.0.0", false), false);
  assert.equal(satisfies(parsed("2.0.0-rc.1"), ">=2.0.0-rc.0 <3.0.0", false), true);
});

test("an unsatisfiable range resolves to nothing", () => {
  assert.equal(maxSatisfying(versions, "^9.0.0", false), null);
  assert.equal(maxSatisfying([], "^1.0.0", false), null);
});
