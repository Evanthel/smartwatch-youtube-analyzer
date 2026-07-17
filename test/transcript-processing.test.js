import assert from "node:assert/strict";
import test from "node:test";

import { SmartWatchError } from "../errors.js";
import { prepareTranscriptForCache } from "../transcript-processing.js";

const TRANSCRIPT = [
  "[Music]",
  "Planning habits improve focus through review execution and clear personal priorities.",
  "Planning habits improve focus through review execution and clear personal priorities.",
  "Teams compare calendar commitments against important projects every morning before meetings.",
  "Weekly reflection turns noisy ideas into practical next steps for deep work.",
  "Simple checklists help people notice risks blockers tradeoffs and useful follow up actions.",
  "Subscribe"
].join("\n");

test("prepareTranscriptForCache cleans, deduplicates, and validates before storage", () => {
  const prepared = prepareTranscriptForCache(TRANSCRIPT);

  assert.doesNotMatch(prepared, /\[Music\]|Subscribe/);
  assert.equal(prepared.match(/Planning habits/g)?.length, 1);
  assert.match(prepared, /Weekly reflection/);
});

test("prepareTranscriptForCache rejects low-quality text before storage", () => {
  assert.throws(
    () => prepareTranscriptForCache("Transcript\nShow transcript\nok"),
    (error) => error instanceof SmartWatchError && error.code === "LOW_QUALITY_TRANSCRIPT"
  );
});
