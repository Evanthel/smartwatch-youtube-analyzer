/**
 * Resolves a prepared transcript for an explicit analysis. A failed automatic
 * prefetch is retried so temporary page or network failures can recover.
 */
export async function getTranscriptRecordForAnalysis(
  transcriptCache,
  context,
  { prefetchFailed = false } = {}
) {
  if (prefetchFailed) {
    return transcriptCache.getOrFetch(context, {
      allowDomFallback: true,
      forceRefresh: true
    });
  }

  try {
    return await transcriptCache.getOrFetch(context, { allowDomFallback: false });
  } catch (_prefetchError) {
    return transcriptCache.getOrFetch(context, {
      allowDomFallback: true,
      forceRefresh: true
    });
  }
}

export function isSameVideoContext(first, second) {
  return Boolean(
    first?.isWatchPage &&
      second?.isWatchPage &&
      first.videoId &&
      first.videoId === second.videoId &&
      first.tabId === second.tabId
  );
}

export function isCurrentPrefetchResult({
  generation,
  currentGeneration,
  activeVideoId,
  resultVideoId
}) {
  return generation === currentGeneration && Boolean(activeVideoId) && activeVideoId === resultVideoId;
}
