import assert from "node:assert/strict";
import test from "node:test";

import {
  TRANSCRIPT_CACHE_VERSION,
  TranscriptCache,
  cacheKey
} from "../transcript-cache.js";

function createStorage(initial = {}) {
  const values = { ...initial };

  return {
    async get(keys) {
      if (keys === null) return { ...values };

      const requested = Array.isArray(keys) ? keys : [keys];
      return Object.fromEntries(
        requested.filter((key) => Object.hasOwn(values, key)).map((key) => [key, values[key]])
      );
    },
    async set(items) {
      Object.assign(values, items);
    },
    async remove(keys) {
      for (const key of Array.isArray(keys) ? keys : [keys]) {
        delete values[key];
      }
    },
    snapshot() {
      return { ...values };
    }
  };
}

function createCache({
  storage = createStorage(),
  fetchTranscript = async ({ videoId }) => `raw:${videoId}`,
  prepareTranscript = (transcript) => `prepared:${transcript}`,
  now = () => 1_000,
  ttlMs = 1_000,
  maxEntries = 5,
  onCacheError = () => {}
} = {}) {
  return new TranscriptCache({
    storageArea: storage,
    fetchTranscript,
    prepareTranscript,
    now,
    ttlMs,
    maxEntries,
    onCacheError
  });
}

test("automatic prefetch enables DOM fallback, prepares, and stores a session transcript", async () => {
  const storage = createStorage();
  const calls = [];
  const cache = createCache({
    storage,
    fetchTranscript: async (context, options) => {
      calls.push({ context, options });
      return "raw transcript";
    }
  });

  const record = await cache.prefetch({ videoId: "video-a", tabId: 3 });

  assert.equal(record.transcript, "prepared:raw transcript");
  assert.equal(record.videoId, "video-a");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.allowDomFallback, true);
  assert.deepEqual(storage.snapshot()[cacheKey("video-a")], record);
});

test("cache hit reuses the transcript for another analysis goal without fetching", async () => {
  let fetchCount = 0;
  const cache = createCache({
    fetchTranscript: async ({ videoId }) => {
      fetchCount += 1;
      return `raw:${videoId}`;
    }
  });

  const first = await cache.getOrFetch({ videoId: "same-video", tabId: 1 });
  const second = await cache.getOrFetch({ videoId: "same-video", tabId: 1 });

  assert.equal(fetchCount, 1);
  assert.deepEqual(second, first);
});

test("concurrent requests for one video share a single in-flight fetch", async () => {
  let fetchCount = 0;
  let resolveFetch;
  const fetchResult = new Promise((resolve) => {
    resolveFetch = resolve;
  });
  const cache = createCache({
    fetchTranscript: async () => {
      fetchCount += 1;
      return fetchResult;
    }
  });

  const first = cache.getOrFetch({ videoId: "video-race", tabId: 1 });
  const second = cache.getOrFetch({ videoId: "video-race", tabId: 1 });
  await Promise.resolve();
  await Promise.resolve();
  resolveFetch("one transcript");

  const [firstRecord, secondRecord] = await Promise.all([first, second]);
  assert.equal(fetchCount, 1);
  assert.deepEqual(secondRecord, firstRecord);
});

test("expired records are removed and fetched again", async () => {
  const expiredRecord = {
    version: TRANSCRIPT_CACHE_VERSION,
    videoId: "expired-video",
    transcript: "old transcript",
    fetchedAt: 100,
    expiresAt: 200
  };
  const storage = createStorage({ [cacheKey("expired-video")]: expiredRecord });
  let fetchCount = 0;
  const cache = createCache({
    storage,
    now: () => 1_000,
    fetchTranscript: async () => {
      fetchCount += 1;
      return "fresh transcript";
    }
  });

  const record = await cache.getOrFetch({ videoId: "expired-video" });

  assert.equal(fetchCount, 1);
  assert.equal(record.transcript, "prepared:fresh transcript");
  assert.notDeepEqual(record, expiredRecord);
});

test("cache prunes expired entries and keeps only the newest configured records", async () => {
  let currentTime = 100;
  const expiredRecord = {
    version: TRANSCRIPT_CACHE_VERSION,
    videoId: "expired-old-video",
    transcript: "expired transcript",
    fetchedAt: 1,
    expiresAt: 2
  };
  const storage = createStorage({
    [cacheKey("expired-old-video")]: expiredRecord
  });
  const cache = createCache({
    storage,
    now: () => currentTime,
    ttlMs: 10_000,
    maxEntries: 2
  });

  await cache.getOrFetch({ videoId: "video-1" }, { forceRefresh: true });
  currentTime += 10;
  await cache.getOrFetch({ videoId: "video-2" }, { forceRefresh: true });
  currentTime += 10;
  await cache.getOrFetch({ videoId: "video-3" }, { forceRefresh: true });

  const snapshot = storage.snapshot();
  assert.equal(snapshot[cacheKey("expired-old-video")], undefined);
  assert.equal(snapshot[cacheKey("video-1")], undefined);
  assert.ok(snapshot[cacheKey("video-2")]);
  assert.ok(snapshot[cacheKey("video-3")]);
});

test("failed transcript requests are not cached and can be retried", async () => {
  const storage = createStorage();
  let fetchCount = 0;
  const cache = createCache({
    storage,
    fetchTranscript: async () => {
      fetchCount += 1;
      if (fetchCount === 1) throw new Error("temporary failure");
      return "recovered transcript";
    }
  });

  await assert.rejects(cache.prefetch({ videoId: "retry-video" }), /temporary failure/);
  assert.equal(storage.snapshot()[cacheKey("retry-video")], undefined);

  const record = await cache.getOrFetch(
    { videoId: "retry-video" },
    { allowDomFallback: true, forceRefresh: true }
  );
  assert.equal(fetchCount, 2);
  assert.equal(record.transcript, "prepared:recovered transcript");
});

test("session storage errors do not prevent the fetched transcript from being analyzed", async () => {
  const storage = createStorage();
  storage.set = async () => {
    throw new Error("quota unavailable");
  };
  const cacheErrors = [];
  const cache = createCache({ storage, onCacheError: (error) => cacheErrors.push(error) });

  const record = await cache.getOrFetch({ videoId: "uncached-video" });

  assert.equal(record.transcript, "prepared:raw:uncached-video");
  assert.equal(cacheErrors.length, 1);
});
