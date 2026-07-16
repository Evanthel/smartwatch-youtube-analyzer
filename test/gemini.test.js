import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_GOAL_PROMPT_TEMPLATE,
  SmartWatchError,
  buildGeminiRequestError,
  buildGenerationConfig,
  buildGoalTerms,
  buildPromptFromTemplate,
  cleanTranscriptForPrompt,
  getThinkingBudgetForModel,
  normalizeTemplate,
  prepareTranscriptForPrompt,
  selectRelevantChunks,
  splitTranscriptIntoChunks,
  summarizeGeminiError,
  validateGoalPromptTemplate
} from "../gemini.js";

const GOOD_TRANSCRIPT = [
  "Planning habits improve focus through review execution and clear personal priorities.",
  "Teams compare calendar commitments against important projects every morning before meetings.",
  "Weekly reflection turns noisy ideas into practical next steps for deep work.",
  "Simple checklists help people notice risks blockers tradeoffs and useful follow up actions."
].join("\n");

const GOOD_TEMPLATE = `Analyze this transcript against the user's practical goals.

Goals:
\${goals}

Transcript:
\${transcript}

Return a concise relevance score, useful insights, next actions, and caveats.`;

test("normalizeTemplate falls back to the default prompt for blank input", () => {
  assert.equal(normalizeTemplate("  "), DEFAULT_GOAL_PROMPT_TEMPLATE);
});

test("validateGoalPromptTemplate rejects missing placeholders and weak instructions", () => {
  assert.throws(
    () => validateGoalPromptTemplate("Explain this video transcript clearly with only ${goals}."),
    /too short|must include/
  );

  assert.throws(
    () =>
      validateGoalPromptTemplate(
        `Goals: \${goals}
Transcript: \${transcript}
Short.`
      ),
    /too short|needs more instruction/
  );
});

test("buildPromptFromTemplate replaces placeholders after cleaning transcript noise", () => {
  const prompt = buildPromptFromTemplate(
    GOOD_TEMPLATE,
    `[Music]\n${GOOD_TRANSCRIPT}\nSubscribe`,
    "improve weekly execution"
  );

  assert.match(prompt, /improve weekly execution/);
  assert.match(prompt, /Planning habits improve focus/);
  assert.doesNotMatch(prompt, /\[Music\]|Subscribe/);
  assert.doesNotMatch(prompt, /\$\{goals\}|\$\{transcript\}/);
});

test("cleanTranscriptForPrompt removes obvious UI noise and short duplicate repeats", () => {
  const cleaned = cleanTranscriptForPrompt(
    [
      "Transcript",
      "00:01",
      "Focus on one meaningful task.",
      "Focus on one meaningful task.",
      "Search in transcript",
      "(applause)",
      "Review outcomes before adding more work."
    ].join("\n")
  );

  assert.equal(cleaned, "Focus on one meaningful task.\nReview outcomes before adding more work.");
});

test("prepareTranscriptForPrompt rejects low-quality transcript fragments", () => {
  assert.throws(
    () => prepareTranscriptForPrompt("transcript\nshow transcript\nok", "goal"),
    (error) => error instanceof SmartWatchError && error.code === "LOW_QUALITY_TRANSCRIPT"
  );
});

test("splitTranscriptIntoChunks groups transcript lines near the target size", () => {
  const chunks = splitTranscriptIntoChunks(
    ["alpha beta gamma", "delta epsilon zeta", "eta theta iota", "kappa lambda mu"].join("\n"),
    40
  );

  assert.deepEqual(chunks, [
    "alpha beta gamma\ndelta epsilon zeta",
    "eta theta iota\nkappa lambda mu"
  ]);
});

test("selectRelevantChunks ranks goal matches while preserving first and last chunks", () => {
  const chunks = [
    "Intro and context",
    "A general aside without matching words",
    "Deep focus productivity system for weekly planning",
    "Closing caveats and summary"
  ];

  assert.deepEqual(selectRelevantChunks(chunks, "weekly focus productivity", 1), [
    "Intro and context",
    "Deep focus productivity system for weekly planning",
    "Closing caveats and summary"
  ]);
});

test("buildGoalTerms ignores very short terms", () => {
  assert.deepEqual(Array.from(buildGoalTerms("AI and deep work in Q3")).sort(), ["deep", "work"]);
});

test("Gemini generation config applies thinking budgets only for supported 2.5 models", () => {
  assert.equal(getThinkingBudgetForModel("gemini-2.5-flash"), 0);
  assert.equal(getThinkingBudgetForModel("gemini-2.5-pro"), 128);
  assert.equal(getThinkingBudgetForModel("gemini-1.5-flash"), null);

  assert.deepEqual(buildGenerationConfig("gemini-2.5-flash"), {
    temperature: 0.3,
    maxOutputTokens: 8192,
    thinkingConfig: { thinkingBudget: 0 }
  });
});

test("summarizeGeminiError prefers structured Google error messages", () => {
  assert.equal(
    summarizeGeminiError(JSON.stringify({ error: { message: "Model not found" } })),
    "Model not found"
  );

  assert.equal(summarizeGeminiError(" plain\n\nerror ".repeat(30)).length, 240);
});

test("buildGeminiRequestError maps known Gemini failure modes to stable codes", () => {
  assert.equal(buildGeminiRequestError(403, "", "gemini-2.5-flash").code, "BAD_API_KEY");
  assert.equal(buildGeminiRequestError(429, "", "gemini-2.5-flash").code, "QUOTA_EXCEEDED");
  assert.equal(
    buildGeminiRequestError(
      404,
      JSON.stringify({ error: { message: "Model is not found" } }),
      "missing-model"
    ).code,
    "MODEL_UNAVAILABLE"
  );
  assert.equal(
    buildGeminiRequestError(400, JSON.stringify({ error: { message: "input token limit exceeded" } }), "model")
      .code,
    "INPUT_TOO_LARGE"
  );
  assert.equal(buildGeminiRequestError(500, "backend unavailable", "model").code, "GEMINI_REQUEST_FAILED");
});
