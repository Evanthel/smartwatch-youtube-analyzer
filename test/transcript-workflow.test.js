import assert from "node:assert/strict";
import test from "node:test";

import {
  getTranscriptRecordForAnalysis,
  isCurrentPrefetchResult,
  isSameVideoContext
} from "../transcript-workflow.js";

test("explicit analysis retries a failed safe fetch with the DOM fallback", async () => {
  const calls = [];
  const cache = {
    async getOrFetch(_context, options) {
      calls.push(options);
      if (!options.allowDomFallback) throw new Error("safe fetch failed");
      return { videoId: "video-a", transcript: "DOM transcript" };
    }
  };

  const record = await getTranscriptRecordForAnalysis(cache, { videoId: "video-a", tabId: 1 });

  assert.equal(record.transcript, "DOM transcript");
  assert.deepEqual(calls, [
    { allowDomFallback: false },
    { allowDomFallback: true, forceRefresh: true }
  ]);
});

test("known prefetch failure goes directly to the explicit DOM-enabled retry", async () => {
  const calls = [];
  const cache = {
    async getOrFetch(_context, options) {
      calls.push(options);
      return { videoId: "video-a", transcript: "retried transcript" };
    }
  };

  await getTranscriptRecordForAnalysis(
    cache,
    { videoId: "video-a", tabId: 1 },
    { prefetchFailed: true }
  );

  assert.deepEqual(calls, [{ allowDomFallback: true, forceRefresh: true }]);
});

test("video context equality requires the same watch video and tab", () => {
  const context = { isWatchPage: true, videoId: "video-a", tabId: 7 };

  assert.equal(isSameVideoContext(context, { ...context }), true);
  assert.equal(isSameVideoContext(context, { ...context, videoId: "video-b" }), false);
  assert.equal(isSameVideoContext(context, { ...context, tabId: 8 }), false);
  assert.equal(isSameVideoContext(context, { ...context, isWatchPage: false }), false);
});

test("stale prefetch results cannot become the active video's transcript state", () => {
  const currentResult = {
    generation: 4,
    currentGeneration: 4,
    activeVideoId: "video-b",
    resultVideoId: "video-b"
  };

  assert.equal(isCurrentPrefetchResult(currentResult), true);
  assert.equal(isCurrentPrefetchResult({ ...currentResult, generation: 3 }), false);
  assert.equal(isCurrentPrefetchResult({ ...currentResult, resultVideoId: "video-a" }), false);
});

test("a delayed prefetch cannot become active after the user changes videos", async () => {
  let resolveOldPrefetch;
  let currentGeneration = 1;
  let activeVideoId = "video-a";
  const oldPrefetch = new Promise((resolve) => {
    resolveOldPrefetch = resolve;
  });
  const canApplyOldResult = oldPrefetch.then((record) =>
    isCurrentPrefetchResult({
      generation: 1,
      currentGeneration,
      activeVideoId,
      resultVideoId: record.videoId
    })
  );

  currentGeneration = 2;
  activeVideoId = "video-b";
  resolveOldPrefetch({ videoId: "video-a", transcript: "old transcript" });

  assert.equal(await canApplyOldResult, false);
  assert.equal(
    isCurrentPrefetchResult({
      generation: 2,
      currentGeneration,
      activeVideoId,
      resultVideoId: "video-b"
    }),
    true
  );
});
