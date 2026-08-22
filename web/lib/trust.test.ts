import assert from "node:assert/strict";
import { test } from "node:test";

import {
  boxStages,
  stageColor,
  STAGES_PER_BOX,
  TRUST_BOXES,
  trustLabel,
  trustScore,
} from "./trust.ts";

test("a package with no advisories is fully trusted", () => {
  assert.equal(trustScore(0, 40), 4);
  assert.equal(trustScore(0, 1), 4);
});

test("many advisories over few versions bottoms out", () => {
  assert.equal(trustScore(2, 3), 0);
  assert.equal(trustScore(1, 1), 0);
  assert.equal(trustScore(9, 4), 0);
});

test("the score falls as advisories per version rises", () => {
  const spread = [trustScore(1, 100), trustScore(1, 20), trustScore(5, 20), trustScore(1, 2)];

  assert.deepEqual(spread, [3.92, 3.6, 2, 0]);

  for (let index = 1; index < spread.length; index += 1) {
    assert.ok((spread[index] ?? 0) < (spread[index - 1] ?? 0));
  }
});

test("a package with no known versions is unrated", () => {
  assert.equal(trustScore(0, 0), null);
  assert.equal(trustScore(3, 0), null);
  assert.equal(trustLabel(null), "unrated");
});

test("boxes fill one point of score at a time", () => {
  assert.deepEqual(boxStages(4), [12, 12, 12, 12]);
  assert.deepEqual(boxStages(0), [0, 0, 0, 0]);
  assert.deepEqual(boxStages(2.5), [12, 12, 6, 0]);
  assert.deepEqual(boxStages(3.25), [12, 12, 12, 3]);
  assert.deepEqual(boxStages(0.5), [6, 0, 0, 0]);
});

test("box stages stay in range for scores outside 0 to 4", () => {
  assert.deepEqual(boxStages(-1), [0, 0, 0, 0]);
  assert.deepEqual(boxStages(9), [12, 12, 12, 12]);
  assert.equal(boxStages(3).length, TRUST_BOXES);
});

test("stage colour runs black to yellow to green", () => {
  assert.equal(stageColor(0), "rgb(20, 32, 43)");
  assert.equal(stageColor(STAGES_PER_BOX / 2), "rgb(224, 184, 32)");
  assert.equal(stageColor(STAGES_PER_BOX), "rgb(47, 158, 94)");
  assert.equal(stageColor(-5), stageColor(0));
  assert.equal(stageColor(99), stageColor(STAGES_PER_BOX));
});

test("every stage has its own colour", () => {
  const colours = new Set(
    Array.from({ length: STAGES_PER_BOX + 1 }, (_, stage) => stageColor(stage)),
  );

  assert.equal(colours.size, STAGES_PER_BOX + 1);
});

test("labels track the score bands", () => {
  assert.equal(trustLabel(4), "solid");
  assert.equal(trustLabel(3), "fair");
  assert.equal(trustLabel(2), "shaky");
  assert.equal(trustLabel(1), "poor");
  assert.equal(trustLabel(0), "bad");
});
