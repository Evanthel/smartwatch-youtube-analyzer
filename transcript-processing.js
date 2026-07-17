import { SmartWatchError } from "./errors.js";

const MIN_CLEAN_TRANSCRIPT_CHARS = 160;
const MIN_CLEAN_TRANSCRIPT_WORDS = 30;

/**
 * Produces the goal-independent transcript form that is safe to cache.
 */
export function prepareTranscriptForCache(transcript) {
  const cleanedTranscript = cleanTranscriptForPrompt(transcript);
  assertTranscriptQuality(cleanedTranscript);
  return cleanedTranscript;
}

export function cleanTranscriptForPrompt(transcript) {
  const lines = (transcript || "")
    .split(/\r?\n+/)
    .map((line) => normalizeTranscriptLine(line))
    .filter(Boolean)
    .filter((line) => !isObviousTranscriptNoise(line));

  const dedupedLines = [];
  const seenCounts = new Map();
  let previousLine = "";

  for (const line of lines) {
    if (line === previousLine) {
      continue;
    }

    const normalizedKey = line.toLowerCase();
    const count = seenCounts.get(normalizedKey) || 0;
    if (count >= 1 && line.length < 90) {
      continue;
    }

    seenCounts.set(normalizedKey, count + 1);
    dedupedLines.push(line);
    previousLine = line;
  }

  return dedupedLines.join("\n").trim();
}

export function normalizeTranscriptLine(line) {
  return (line || "")
    .replace(/\[(music|applause|laughter|foreign|inaudible)[^\]]*\]/gi, " ")
    .replace(/\((music|applause|laughter|foreign|inaudible)[^)]*\)/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function isObviousTranscriptNoise(line) {
  const normalized = line.toLowerCase();

  if (!normalized) return true;
  if (/^(\d{1,2}:)?\d{1,2}:\d{2}$/.test(normalized)) return true;
  if (normalized.length <= 2) return true;

  return (
    normalized === "transcript" ||
    normalized === "show transcript" ||
    normalized === "search in transcript" ||
    normalized === "transcript search" ||
    normalized === "subscribe" ||
    normalized === "subtitles by" ||
    normalized === "captions by" ||
    normalized === "[music]" ||
    normalized === "[applause]" ||
    normalized === "[laughter]"
  );
}

export function assertTranscriptQuality(transcript) {
  const normalizedTranscript = (transcript || "").trim();
  const words = normalizedTranscript.split(/\s+/).filter(Boolean);
  const uniqueTerms = new Set(
    words.map((word) => word.toLowerCase().replace(/^[^a-z0-9]+|[^a-z0-9]+$/gi, "")).filter(Boolean)
  );

  if (
    normalizedTranscript.length < MIN_CLEAN_TRANSCRIPT_CHARS ||
    words.length < MIN_CLEAN_TRANSCRIPT_WORDS ||
    uniqueTerms.size < 12
  ) {
    throw new SmartWatchError(
      "LOW_QUALITY_TRANSCRIPT",
      "The transcript is empty or too low-quality to analyze reliably."
    );
  }
}

export function splitTranscriptIntoChunks(transcript, targetChars) {
  const lines = transcript
    .split(/\r?\n+/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    return [transcript];
  }

  const chunks = [];
  let currentChunk = "";

  for (const line of lines) {
    const candidate = currentChunk ? `${currentChunk}\n${line}` : line;
    if (candidate.length > targetChars && currentChunk) {
      chunks.push(currentChunk);
      currentChunk = line;
      continue;
    }
    currentChunk = candidate;
  }

  if (currentChunk) {
    chunks.push(currentChunk);
  }

  return chunks;
}
