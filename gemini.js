const API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
export const DEFAULT_MODEL = "gemini-2.5-flash";
const MIN_TEMPLATE_LENGTH = 80;
const MIN_TEMPLATE_INSTRUCTION_LENGTH = 24;
const MAX_TRANSCRIPT_CHARS = 24000;
const CHUNK_TARGET_CHARS = 2200;
const MAX_SELECTED_CHUNKS = 8;
const MAX_OUTPUT_TOKENS = 8192;
const FLASH_THINKING_BUDGET = 0;
const PRO_THINKING_BUDGET = 128;
const MIN_CLEAN_TRANSCRIPT_CHARS = 160;
const MIN_CLEAN_TRANSCRIPT_WORDS = 30;
export const DEFAULT_GOAL_PROMPT_TEMPLATE = `You are analyzing a YouTube video transcript in relation to user goals.

User goals:
\${goals}

Video transcript:
\${transcript}

Explain:
1. Relevance score (0-100) and short justification
2. Most useful insights for the user goals
3. Actionable next steps
4. Risks, caveats, or blind spots

Keep the answer concise but complete. Use clear section headings.`;

export class SmartWatchError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "SmartWatchError";
    this.code = code;
  }
}

/**
 * Analyzes a full transcript against user goals and returns focused recommendations.
 */
export async function analyzeTranscriptForGoals(transcript, goals, apiKey, model = DEFAULT_MODEL) {
  const prompt = buildPromptFromTemplate(DEFAULT_GOAL_PROMPT_TEMPLATE, transcript, goals);

  return callGemini(prompt, apiKey, model);
}

/**
 * Analyzes transcript against goals using a custom user template.
 */
export async function analyzeTranscriptWithTemplate(
  transcript,
  goals,
  apiKey,
  template,
  model = DEFAULT_MODEL
) {
  const normalizedTemplate = normalizeTemplate(template);
  const prompt = buildPromptFromTemplate(normalizedTemplate, transcript, goals);

  return callGemini(prompt, apiKey, model);
}

function buildPromptFromTemplate(template, transcript, goals) {
  const preparedTranscript = prepareTranscriptForPrompt(transcript, goals);
  const withGoals = template.replaceAll("${goals}", goals);
  const withTranscript = withGoals.replaceAll("${transcript}", preparedTranscript);

  const hasGoalsPlaceholder = template.includes("${goals}");
  const hasTranscriptPlaceholder = template.includes("${transcript}");

  if (hasGoalsPlaceholder && hasTranscriptPlaceholder) {
    return withTranscript;
  }

  return `${withTranscript}

User goals:
${goals}

Video transcript:
${preparedTranscript}`;
}

async function callGemini(prompt, apiKey, model = DEFAULT_MODEL) {
  if (!apiKey) {
    throw new SmartWatchError("BAD_API_KEY", "Gemini API key is missing.");
  }

  const selectedModel = (model || "").trim() || DEFAULT_MODEL;

  return requestGeminiCompletion(prompt, apiKey, selectedModel, { retryOnMaxTokens: true });
}

async function requestGeminiCompletion(prompt, apiKey, selectedModel, options = {}) {
  const retryOnMaxTokens = options.retryOnMaxTokens === true;

  const response = await fetch(
    `${API_BASE}/${encodeURIComponent(selectedModel)}:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: buildGenerationConfig(selectedModel)
      })
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    const compactError = summarizeGeminiError(errorText);

    if (response.status === 401 || response.status === 403) {
      throw new SmartWatchError("BAD_API_KEY", "Your API key is invalid.");
    }
    if (response.status === 429) {
      throw new SmartWatchError(
        "QUOTA_EXCEEDED",
        `Gemini quota/rate limit exceeded for model ${selectedModel}.`
      );
    }
    if (looksLikeModelUnavailable(response.status, compactError)) {
      throw new SmartWatchError(
        "MODEL_UNAVAILABLE",
        `The selected model "${selectedModel}" is unavailable.`
      );
    }
    if (looksLikeInputTooLarge(response.status, compactError)) {
      throw new SmartWatchError(
        "INPUT_TOO_LARGE",
        "The transcript is still too large for this model. Try a shorter video or a more compact prompt."
      );
    }

    throw new SmartWatchError(
      "GEMINI_REQUEST_FAILED",
      compactError
        ? `Gemini request failed (${response.status}): ${compactError}`
        : `Gemini request failed (${response.status}).`
    );
  }

  const raw = await response.text();
  if (!raw.trim()) {
    throw new SmartWatchError("EMPTY_MODEL_RESPONSE", "Gemini returned an empty response body.");
  }

  let data;
  try {
    data = JSON.parse(raw);
  } catch (_parseError) {
    throw new SmartWatchError("INVALID_MODEL_RESPONSE", "Gemini returned a non-JSON response.");
  }

  const candidate = data?.candidates?.[0];
  const text = candidate?.content?.parts
    ?.map((part) => part.text || "")
    .join("\n")
    .trim();

  if (candidate?.finishReason === "MAX_TOKENS") {
    if (retryOnMaxTokens) {
      return requestGeminiCompletion(buildConciseRetryPrompt(prompt), apiKey, selectedModel, {
        retryOnMaxTokens: false
      });
    }

    throw new SmartWatchError(
      "OUTPUT_TOO_LONG",
      "Gemini stopped because the analysis exceeded the output limit. Try a shorter prompt template or a more focused goal."
    );
  }

  if (!text) {
    throw new SmartWatchError("EMPTY_MODEL_RESPONSE", "Gemini returned an empty response.");
  }

  return text;
}

function buildGenerationConfig(model) {
  const generationConfig = {
    temperature: 0.3,
    maxOutputTokens: MAX_OUTPUT_TOKENS
  };

  const thinkingBudget = getThinkingBudgetForModel(model);
  if (thinkingBudget !== null) {
    generationConfig.thinkingConfig = { thinkingBudget };
  }

  return generationConfig;
}

function getThinkingBudgetForModel(model) {
  const normalizedModel = (model || "").toLowerCase();

  if (!normalizedModel.includes("gemini-2.5-")) {
    return null;
  }

  if (normalizedModel.includes("flash")) {
    return FLASH_THINKING_BUDGET;
  }

  if (normalizedModel.includes("pro")) {
    return PRO_THINKING_BUDGET;
  }

  return null;
}

function buildConciseRetryPrompt(originalPrompt) {
  return `${originalPrompt}

The previous answer exceeded the output budget. Return a complete, concise analysis under 700 words.
Include all requested sections, especially risks/caveats/blind spots. Do not trail off mid-sentence.`;
}

function summarizeGeminiError(errorText) {
  if (!errorText) return "";

  try {
    const parsed = JSON.parse(errorText);
    const message = parsed?.error?.message;
    return typeof message === "string" ? message.trim() : "";
  } catch (_error) {
    return errorText.trim().replace(/\s+/g, " ").slice(0, 240);
  }
}

export function normalizeTemplate(template) {
  const normalizedTemplate = (template || "").trim() || DEFAULT_GOAL_PROMPT_TEMPLATE;
  validateGoalPromptTemplate(normalizedTemplate);
  return normalizedTemplate;
}

export function validateGoalPromptTemplate(template) {
  const normalizedTemplate = (template || "").trim();
  if (!normalizedTemplate) {
    throw new Error("Custom prompt template cannot be empty.");
  }

  if (normalizedTemplate.length < MIN_TEMPLATE_LENGTH) {
    throw new Error("Custom prompt template is too short. Add clearer instructions.");
  }

  const hasGoalsPlaceholder = normalizedTemplate.includes("${goals}");
  const hasTranscriptPlaceholder = normalizedTemplate.includes("${transcript}");
  if (!hasGoalsPlaceholder || !hasTranscriptPlaceholder) {
    throw new Error("Custom prompt template must include both ${goals} and ${transcript}.");
  }

  const instructionText = normalizedTemplate
    .replaceAll("${goals}", "")
    .replaceAll("${transcript}", "")
    .replace(/\s+/g, " ")
    .trim();

  if (instructionText.length < MIN_TEMPLATE_INSTRUCTION_LENGTH) {
    throw new Error("Custom prompt template needs more instruction text beyond the placeholders.");
  }
}

function prepareTranscriptForPrompt(transcript, goals) {
  const cleanedTranscript = cleanTranscriptForPrompt(transcript);
  assertTranscriptQuality(cleanedTranscript);

  if (cleanedTranscript.length <= MAX_TRANSCRIPT_CHARS) {
    return cleanedTranscript;
  }

  const chunks = splitTranscriptIntoChunks(cleanedTranscript, CHUNK_TARGET_CHARS);
  if (chunks.length <= 1) {
    return cleanedTranscript.slice(0, MAX_TRANSCRIPT_CHARS).trim();
  }

  const selectedChunks = selectRelevantChunks(chunks, goals, MAX_SELECTED_CHUNKS);
  const compactTranscript = selectedChunks.join("\n\n").trim();

  if (compactTranscript.length <= MAX_TRANSCRIPT_CHARS) {
    return compactTranscript;
  }

  return compactTranscript.slice(0, MAX_TRANSCRIPT_CHARS).trim();
}

function splitTranscriptIntoChunks(transcript, targetChars) {
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

function selectRelevantChunks(chunks, goals, limit) {
  const goalTerms = buildGoalTerms(goals);
  const scored = chunks.map((chunk, index) => ({
    chunk,
    index,
    score: scoreChunk(chunk, goalTerms)
  }));

  const ranked = scored
    .slice()
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, Math.min(limit, chunks.length));

  const selectedIndices = new Set(ranked.map((item) => item.index));
  selectedIndices.add(0);
  selectedIndices.add(chunks.length - 1);

  return chunks.filter((_chunk, index) => selectedIndices.has(index));
}

function buildGoalTerms(goals) {
  return new Set(
    (goals || "")
      .toLowerCase()
      .split(/[^a-z0-9]+/i)
      .map((term) => term.trim())
      .filter((term) => term.length >= 4)
  );
}

function scoreChunk(chunk, goalTerms) {
  if (goalTerms.size === 0) return 0;

  const lowerChunk = chunk.toLowerCase();
  let score = 0;

  for (const term of goalTerms) {
    if (lowerChunk.includes(term)) {
      score += 1;
    }
  }

  return score;
}

function cleanTranscriptForPrompt(transcript) {
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

function normalizeTranscriptLine(line) {
  return (line || "")
    .replace(/\[(music|applause|laughter|foreign|inaudible)[^\]]*\]/gi, " ")
    .replace(/\((music|applause|laughter|foreign|inaudible)[^)]*\)/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isObviousTranscriptNoise(line) {
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

function assertTranscriptQuality(transcript) {
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

function looksLikeModelUnavailable(status, message) {
  if (status !== 400 && status !== 404) return false;
  const normalized = (message || "").toLowerCase();
  return (
    normalized.includes("model") &&
    (normalized.includes("not found") ||
      normalized.includes("not available") ||
      normalized.includes("unsupported") ||
      normalized.includes("unknown"))
  );
}

function looksLikeInputTooLarge(status, message) {
  if (status !== 400 && status !== 413) return false;
  const normalized = (message || "").toLowerCase();
  return (
    normalized.includes("too large") ||
    normalized.includes("too long") ||
    normalized.includes("context") ||
    normalized.includes("token") ||
    normalized.includes("input")
  );
}
