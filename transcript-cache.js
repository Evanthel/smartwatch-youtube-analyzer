export const TRANSCRIPT_CACHE_VERSION = 1;
export const TRANSCRIPT_CACHE_PREFIX = `smartwatch:transcript:v${TRANSCRIPT_CACHE_VERSION}:`;
export const DEFAULT_TRANSCRIPT_CACHE_TTL_MS = 60 * 60 * 1000;
export const DEFAULT_TRANSCRIPT_CACHE_MAX_ENTRIES = 5;

/**
 * Stores cleaned transcripts for the current browser session and deduplicates
 * concurrent fetches for the same video.
 */
export class TranscriptCache {
  constructor({
    storageArea,
    fetchTranscript,
    prepareTranscript,
    now = () => Date.now(),
    ttlMs = DEFAULT_TRANSCRIPT_CACHE_TTL_MS,
    maxEntries = DEFAULT_TRANSCRIPT_CACHE_MAX_ENTRIES,
    onCacheError = (error) => console.warn("[SmartWatch] Transcript cache unavailable.", error)
  }) {
    if (!storageArea || typeof storageArea.get !== "function") {
      throw new Error("A session storage area is required for transcript caching.");
    }
    if (typeof fetchTranscript !== "function") {
      throw new Error("A transcript fetch function is required.");
    }
    if (typeof prepareTranscript !== "function") {
      throw new Error("A transcript preparation function is required.");
    }

    this.storageArea = storageArea;
    this.fetchTranscript = fetchTranscript;
    this.prepareTranscript = prepareTranscript;
    this.now = now;
    this.ttlMs = ttlMs;
    this.maxEntries = maxEntries;
    this.onCacheError = onCacheError;
    this.inFlight = new Map();
  }

  async prefetch(context, { forceRefresh = false } = {}) {
    return this.getOrFetch(context, { allowDomFallback: true, forceRefresh });
  }

  async getOrFetch(context, { allowDomFallback = false, forceRefresh = false } = {}) {
    const normalizedContext = normalizeContext(context);

    if (!forceRefresh) {
      const cached = await this.get(normalizedContext.videoId);
      if (cached) return cached;
    }

    const existing = this.inFlight.get(normalizedContext.videoId);
    if (existing) return existing;

    let trackedRequest;
    trackedRequest = this.fetchAndStore(normalizedContext, { allowDomFallback }).finally(() => {
      if (this.inFlight.get(normalizedContext.videoId) === trackedRequest) {
        this.inFlight.delete(normalizedContext.videoId);
      }
    });
    this.inFlight.set(normalizedContext.videoId, trackedRequest);

    return trackedRequest;
  }

  async get(videoId) {
    const key = cacheKey(videoId);
    let values;

    try {
      values = await this.storageArea.get(key);
    } catch (error) {
      this.onCacheError(error);
      return null;
    }

    const record = values?.[key];
    if (!isValidRecord(record, videoId) || record.expiresAt <= this.now()) {
      if (record !== undefined) {
        await this.removeKeys([key]);
      }
      return null;
    }

    return record;
  }

  async fetchAndStore(context, { allowDomFallback }) {
    const rawTranscript = await this.fetchTranscript(context, { allowDomFallback });
    const transcript = this.prepareTranscript(rawTranscript);
    const fetchedAt = this.now();
    const record = {
      version: TRANSCRIPT_CACHE_VERSION,
      videoId: context.videoId,
      transcript,
      fetchedAt,
      expiresAt: fetchedAt + this.ttlMs
    };

    try {
      await this.storageArea.set({ [cacheKey(context.videoId)]: record });
      await this.prune();
    } catch (error) {
      this.onCacheError(error);
    }

    return record;
  }

  async prune() {
    let values;

    try {
      values = await this.storageArea.get(null);
    } catch (error) {
      this.onCacheError(error);
      return;
    }

    const now = this.now();
    const entries = Object.entries(values || {}).filter(([key]) => key.startsWith(TRANSCRIPT_CACHE_PREFIX));
    const keysToRemove = [];
    const currentEntries = [];

    for (const [key, record] of entries) {
      if (!isValidRecord(record) || record.expiresAt <= now) {
        keysToRemove.push(key);
      } else {
        currentEntries.push([key, record]);
      }
    }

    currentEntries.sort((a, b) => b[1].fetchedAt - a[1].fetchedAt);
    for (const [key] of currentEntries.slice(this.maxEntries)) {
      keysToRemove.push(key);
    }

    await this.removeKeys(keysToRemove);
  }

  async removeKeys(keys) {
    if (keys.length === 0) return;

    try {
      await this.storageArea.remove(keys);
    } catch (error) {
      this.onCacheError(error);
    }
  }
}

export function cacheKey(videoId) {
  const normalizedVideoId = String(videoId || "").trim();
  if (!normalizedVideoId) {
    throw new Error("A video ID is required for transcript caching.");
  }
  return `${TRANSCRIPT_CACHE_PREFIX}${normalizedVideoId}`;
}

export function isValidRecord(record, expectedVideoId = "") {
  if (!record || typeof record !== "object") return false;
  if (record.version !== TRANSCRIPT_CACHE_VERSION) return false;
  if (typeof record.videoId !== "string" || !record.videoId) return false;
  if (expectedVideoId && record.videoId !== expectedVideoId) return false;
  if (typeof record.transcript !== "string" || !record.transcript.trim()) return false;
  if (!Number.isFinite(record.fetchedAt) || !Number.isFinite(record.expiresAt)) return false;
  return record.expiresAt > record.fetchedAt;
}

function normalizeContext(context) {
  const videoId = String(context?.videoId || "").trim();
  if (!videoId) {
    throw new Error("A video ID is required to fetch a transcript.");
  }

  return {
    ...context,
    videoId
  };
}
