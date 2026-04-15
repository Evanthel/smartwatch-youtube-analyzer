import {
  analyzeTranscriptWithTemplate,
  DEFAULT_MODEL,
  DEFAULT_GOAL_PROMPT_TEMPLATE,
  normalizeTemplate,
  SmartWatchError
} from "./gemini.js";
import { getTranscript } from "./transcript.js";

const DEFAULT_GOALS_TEXT = "Find actionable productivity ideas I can apply this week";

const analyzeBtn = document.getElementById("analyzeBtn");
const analysisOutput = document.getElementById("analysisOutput");
const goalsInput = document.getElementById("goalsInput");
const ctaStatus = document.getElementById("ctaStatus");
const apiKeyInput = document.getElementById("apiKey");
const apiKeyLabel = document.getElementById("apiKeyLabel");
const modelPresetSelect = document.getElementById("modelPresetSelect");
const customModelGroup = document.getElementById("customModelGroup");
const modelInput = document.getElementById("modelInput");
const settingsToggleBtn = document.getElementById("settingsToggleBtn");
const closePanelBtn = document.getElementById("closePanelBtn");
const mainView = document.getElementById("mainView");
const settingsView = document.getElementById("settingsView");
const settingsStatus = document.getElementById("settingsStatus");
const saveSettingsBtn = document.getElementById("saveSettingsBtn");
const promptTemplateInput = document.getElementById("promptTemplateInput");
const MODEL_PRESETS = new Set(["gemini-2.5-flash", "gemini-2.5-pro"]);

let lastOutputMarkdown = "";
let lastAnalyzeButtonLabel = analyzeBtn.textContent;

init();

async function init() {
  const {
    geminiApiKey = "",
    savedGoals = "",
    goalPromptTemplate = DEFAULT_GOAL_PROMPT_TEMPLATE,
    geminiModel = DEFAULT_MODEL
  } = await chrome.storage.local.get([
    "geminiApiKey",
    "savedGoals",
    "goalPromptTemplate",
    "geminiModel"
  ]);

  apiKeyInput.value = geminiApiKey;
  goalsInput.value = savedGoals.trim() ? savedGoals : DEFAULT_GOALS_TEXT;
  applyStoredModel(geminiModel);
  promptTemplateInput.value = goalPromptTemplate;
  apiKeyLabel.textContent = "Gemini API Key";
  goalsInput.focus();
  goalsInput.setSelectionRange(goalsInput.value.length, goalsInput.value.length);
  updateGoalUi();
  renderEmptyState();

  goalsInput.addEventListener("input", async () => {
    await chrome.storage.local.set({ savedGoals: goalsInput.value });
    updateGoalUi();
  });

  settingsToggleBtn.addEventListener("click", toggleSettings);
  closePanelBtn.addEventListener("click", () => window.close());
  modelPresetSelect.addEventListener("change", updateModelUi);
  saveSettingsBtn.addEventListener("click", saveSettings);
  analyzeBtn.addEventListener("click", onAnalyze);
}

function toggleSettings() {
  const showingSettings = settingsView.classList.contains("hidden");
  if (showingSettings) {
    mainView.classList.add("hidden");
    settingsView.classList.remove("hidden");
    settingsToggleBtn.setAttribute("aria-label", "Close settings");
    apiKeyInput.focus();
    return;
  }

  closeSettings();
}

function closeSettings() {
  mainView.classList.remove("hidden");
  settingsView.classList.add("hidden");
  settingsToggleBtn.setAttribute("aria-label", "Open settings");
  settingsToggleBtn.focus();
}

async function saveSettings() {
  const key = apiKeyInput.value.trim();
  const geminiModel = getSelectedModel();

  try {
    const goalPromptTemplate = normalizeTemplate(promptTemplateInput.value);

    await chrome.storage.local.set({
      geminiApiKey: key,
      geminiModel,
      goalPromptTemplate
    });

    promptTemplateInput.value = goalPromptTemplate;
    setSettingsStatus("Settings saved.", "status-success");
    saveSettingsBtn.textContent = "Saved";
    setTimeout(() => {
      saveSettingsBtn.textContent = "Save settings";
      setSettingsStatus("", "");
    }, 900);
  } catch (error) {
    setSettingsStatus(toUserError(error), "status-error");
  }
}

async function getTranscriptWithFallback(videoId, tabId) {
  let transcript = "";
  let networkError = null;

  try {
    transcript = await getTranscript(videoId, tabId);
  } catch (error) {
    networkError = error;
  }

  if (isUsableTranscript(transcript)) {
    return transcript;
  }

  if (!tabId) {
    throw new Error("Transcript unavailable for this video.");
  }

  try {
    const response = await sendMessageWithInjection(tabId, { type: "EXTRACT_TRANSCRIPT_DOM" });
    if (response?.ok && response.transcript) {
      transcript = response.transcript;
      if (isUsableTranscript(transcript)) {
        if (networkError) {
          console.debug("[SmartWatch] Falling back to DOM transcript extraction.", networkError);
        }
        return transcript;
      }
      throw new Error("Transcript was found, but it does not contain enough real video content.");
    }
    if (response?.error) {
      throw new Error(response.error);
    }
  } catch (domError) {
    throw new Error(
      `Transcript unavailable for this video. DOM fallback failed: ${
        domError instanceof Error ? domError.message : "Unknown error"
      }`
    );
  }

  throw new Error("Transcript unavailable for this video.");
}

async function sendMessageWithInjection(tabId, message) {
  try {
    return await chrome.tabs.sendMessage(tabId, message);
  } catch (error) {
    const messageText = error instanceof Error ? error.message : String(error);
    if (!/Receiving end does not exist/i.test(messageText)) {
      throw error;
    }

    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content.js"]
    });

    return chrome.tabs.sendMessage(tabId, message);
  }
}

async function onAnalyze() {
  setLoading();
  renderSkeletonState();

  try {
    const apiKey = await getApiKeyOrThrow();
    const goals = goalsInput.value.trim();
    const context = await getCurrentVideoContext();
    const template = normalizeTemplate(promptTemplateInput.value);
    const model = getSelectedModel();

    if (!context.isWatchPage || !context.videoId) {
      throw new Error("Go to YouTube.");
    }

    if (!goals) {
      throw new Error("Enter your goals before analysis.");
    }

    const transcript = await getTranscriptWithFallback(context.videoId, context.tabId);
    console.debug("[SmartWatch] Transcript length:", transcript.length);

    const analysis = await analyzeTranscriptWithTemplate(transcript, goals, apiKey, template, model);
    setOutputMarkdown(analysis);
    setCtaStatus("Analysis ready.", "status-success");
  } catch (error) {
    console.error("[SmartWatch] Analyze error:", error);
    const userError = toUserError(error);
    setOutputMarkdown(userError);
    setCtaStatus(userError, "status-error");
  } finally {
    clearLoading();
  }
}

function setOutputMarkdown(markdown) {
  lastOutputMarkdown = markdown || "";
  analysisOutput.classList.remove("empty-state");
  analysisOutput.innerHTML = renderMarkdown(lastOutputMarkdown || "");
}

function renderEmptyState() {
  lastOutputMarkdown = "";
  analysisOutput.classList.add("empty-state");
  analysisOutput.innerHTML = '<p class="empty-title">No results yet.</p>';
}

function renderSkeletonState() {
  lastOutputMarkdown = "";
  analysisOutput.classList.remove("empty-state");
  analysisOutput.innerHTML =
    '<div class="skeleton">' +
    '<div class="skeleton-line short"></div>' +
    '<div class="skeleton-line"></div>' +
    '<div class="skeleton-line mid"></div>' +
    '<div class="skeleton-line"></div>' +
    '<div class="skeleton-line short"></div>' +
    "</div>";
}

function renderMarkdown(markdown) {
  const lines = markdown.split(/\r?\n/);
  const htmlParts = [];
  let inUl = false;
  let inOl = false;

  const closeLists = () => {
    if (inUl) {
      htmlParts.push("</ul>");
      inUl = false;
    }
    if (inOl) {
      htmlParts.push("</ol>");
      inOl = false;
    }
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (!line) {
      closeLists();
      continue;
    }

    const heading = line.match(/^(#{1,3})\s+(.*)$/);
    if (heading) {
      closeLists();
      const level = heading[1].length;
      htmlParts.push(`<h${level}>${renderInlineMarkdown(heading[2])}</h${level}>`);
      continue;
    }

    const ul = line.match(/^[-*]\s+(.*)$/);
    if (ul) {
      if (inOl) {
        htmlParts.push("</ol>");
        inOl = false;
      }
      if (!inUl) {
        htmlParts.push("<ul>");
        inUl = true;
      }
      htmlParts.push(`<li>${renderInlineMarkdown(ul[1])}</li>`);
      continue;
    }

    const ol = line.match(/^\d+\.\s+(.*)$/);
    if (ol) {
      if (inUl) {
        htmlParts.push("</ul>");
        inUl = false;
      }
      if (!inOl) {
        htmlParts.push("<ol>");
        inOl = true;
      }
      htmlParts.push(`<li>${renderInlineMarkdown(ol[1])}</li>`);
      continue;
    }

    closeLists();
    htmlParts.push(`<p>${renderInlineMarkdown(line)}</p>`);
  }

  closeLists();
  return htmlParts.join("\n") || "<p>No analysis yet.</p>";
}

function renderInlineMarkdown(text) {
  let escaped = escapeHtml(text);

  escaped = escaped.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (_m, label, url) => {
    return `<a href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>`;
  });
  escaped = escaped.replace(/`([^`]+)`/g, "<code>$1</code>");
  escaped = escaped.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  escaped = escaped.replace(/\*([^*]+)\*/g, "<em>$1</em>");

  return escaped;
}

function escapeHtml(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function getApiKeyOrThrow() {
  const keyFromInput = apiKeyInput.value.trim();
  if (keyFromInput) return keyFromInput;

  const { geminiApiKey = "" } = await chrome.storage.local.get("geminiApiKey");
  if (!geminiApiKey) {
    throw new Error("Gemini API key is required. Open settings and add it.");
  }
  return geminiApiKey;
}

async function getCurrentVideoContext() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    return { isWatchPage: false, videoId: "" };
  }

  try {
    const response = await sendMessageWithInjection(tab.id, { type: "GET_VIDEO_CONTEXT" });
    if (response) return { ...response, tabId: tab.id };
  } catch (_error) {
    // Fallback below if content script is temporarily unavailable.
  }

  const url = tab.url || "";
  try {
    const parsed = new URL(url);
    return {
      isWatchPage: parsed.hostname === "www.youtube.com" && parsed.pathname === "/watch",
      videoId: parsed.searchParams.get("v") || "",
      tabId: tab.id,
      url
    };
  } catch {
    return { isWatchPage: false, videoId: "", tabId: tab.id, url };
  }
}

function setLoading() {
  analyzeBtn.disabled = true;
  analyzeBtn.textContent = "Analyzing...";
  analyzeBtn.setAttribute("aria-busy", "true");
  setCtaStatus("Pulling transcript and generating the analysis.", "");
}

function clearLoading() {
  analyzeBtn.disabled = !goalsInput.value.trim();
  analyzeBtn.textContent = lastAnalyzeButtonLabel;
  analyzeBtn.removeAttribute("aria-busy");
}

function toUserError(error) {
  if (error instanceof SmartWatchError) {
    switch (error.code) {
      case "BAD_API_KEY":
      case "QUOTA_EXCEEDED":
      case "MODEL_UNAVAILABLE":
      case "INPUT_TOO_LARGE":
      case "LOW_QUALITY_TRANSCRIPT":
      case "EMPTY_MODEL_RESPONSE":
      case "INVALID_MODEL_RESPONSE":
      case "OUTPUT_TOO_LONG":
        return error.message;
      default:
        return error.message || "Unexpected error occurred.";
    }
  }

  return error instanceof Error ? error.message : "Unexpected error occurred.";
}

function isUsableTranscript(transcript) {
  const normalized = (transcript || "").replace(/\s+/g, " ").trim();
  if (!normalized) return false;
  if (normalized.length < 40) return false;

  const lower = normalized.toLowerCase();
  const blockedValues = new Set([
    "transcript",
    "show transcript",
    "transcript transcript",
    "open transcript",
    "search in transcript",
    "transcript search"
  ]);
  if (blockedValues.has(lower)) return false;

  const words = normalized.split(" ").filter(Boolean);
  if (words.length < 8) return false;

  const uniqueWords = new Set(words.map((word) => word.toLowerCase()));
  return uniqueWords.size >= 6;
}

function updateGoalUi() {
  const value = goalsInput.value.trim();
  analyzeBtn.disabled = !value;

  if (!value) {
    setCtaStatus("", "");
    return;
  }

  setCtaStatus("", "");
}

function setCtaStatus(message, className) {
  ctaStatus.textContent = message;
  ctaStatus.className = "cta-status";
  if (className) ctaStatus.classList.add(className);
}

function setSettingsStatus(message, className) {
  settingsStatus.textContent = message;
  settingsStatus.className = "settings-status";
  if (className) settingsStatus.classList.add(className);
}

function applyStoredModel(model) {
  const normalizedModel = (model || "").trim() || DEFAULT_MODEL;

  if (MODEL_PRESETS.has(normalizedModel)) {
    modelPresetSelect.value = normalizedModel;
    modelInput.value = "";
  } else {
    modelPresetSelect.value = "custom";
    modelInput.value = normalizedModel;
  }

  updateModelUi();
}

function updateModelUi() {
  const usingCustomModel = modelPresetSelect.value === "custom";
  customModelGroup.classList.toggle("hidden", !usingCustomModel);

  if (usingCustomModel) {
    modelInput.focus();
  }
}

function getSelectedModel() {
  if (modelPresetSelect.value === "custom") {
    return (modelInput.value || "").trim() || DEFAULT_MODEL;
  }

  return modelPresetSelect.value || DEFAULT_MODEL;
}
