import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const CONTENT_SCRIPT = readFileSync(new URL("../content.js", import.meta.url), "utf8");

class FakeElement {
  constructor(text = "") {
    this.innerText = text;
    this.textContent = text;
    this.childElementCount = 0;
    this.clicked = false;
  }

  click() {
    this.clicked = true;
  }

  querySelectorAll() {
    return [];
  }

  getAttribute() {
    return null;
  }
}

function createContentScriptHarness({
  transcriptText,
  revealAfterClick = false,
  revealButtonAfterDescriptionExpand = false,
  useModernSegment = false,
  transcriptRevealDelayMs = 0
}) {
  let transcriptVisible = !revealAfterClick;
  let transcriptButtonVisible = revealAfterClick && !revealButtonAfterDescriptionExpand;
  let listener;
  const segment = new FakeElement(transcriptText);
  const showTranscriptButton = new FakeElement("Show transcript");
  const expandDescriptionButton = new FakeElement("...więcej");
  expandDescriptionButton.click = () => {
    expandDescriptionButton.clicked = true;
    transcriptButtonVisible = true;
  };
  showTranscriptButton.click = () => {
    showTranscriptButton.clicked = true;
    transcriptButtonVisible = false;
    if (transcriptRevealDelayMs > 0) {
      setTimeout(() => {
        transcriptVisible = true;
      }, transcriptRevealDelayMs);
    } else {
      transcriptVisible = true;
    }
  };

  const document = {
    body: {},
    documentElement: {},
    querySelectorAll(selector) {
      if (
        selector ===
        "ytd-video-description-transcript-section-renderer button, ytd-video-description-transcript-section-renderer tp-yt-paper-button"
      ) {
        return transcriptButtonVisible ? [showTranscriptButton] : [];
      }
      if (selector === "button, tp-yt-paper-button") {
        return transcriptButtonVisible ? [showTranscriptButton] : [];
      }
      if (
        selector ===
        "ytd-watch-metadata ytd-text-inline-expander #expand, ytd-watch-metadata #description #expand, ytd-text-inline-expander tp-yt-paper-button#expand"
      ) {
        return revealButtonAfterDescriptionExpand && !transcriptButtonVisible
          ? [expandDescriptionButton]
          : [];
      }
      if (selector === "transcript-segment-view-model [role='text']") {
        return useModernSegment && transcriptVisible ? [segment] : [];
      }
      if (selector === "#segments-container [role='listitem']") {
        return !useModernSegment && transcriptVisible ? [segment] : [];
      }
      return [];
    }
  };

  const window = {
    location: { href: "https://www.youtube.com/watch?v=abcdefghijk" },
    getComputedStyle: () => ({ display: "block", visibility: "visible" })
  };

  const context = {
    URL,
    window,
    document,
    Element: FakeElement,
    MutationObserver: class {
      observe() {}
      disconnect() {}
    },
    NodeFilter: {
      SHOW_TEXT: 4,
      FILTER_REJECT: 2,
      FILTER_ACCEPT: 1
    },
    chrome: {
      runtime: {
        onMessage: {
          addListener(callback) {
            listener = callback;
          }
        }
      }
    },
    console,
    setInterval,
    clearInterval,
    setTimeout,
    clearTimeout
  };

  vm.runInNewContext(CONTENT_SCRIPT, context);

  return {
    expandDescriptionButton,
    showTranscriptButton,
    extractTranscript() {
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("Content script did not respond.")), 1_000);
        listener({ type: "EXTRACT_TRANSCRIPT_DOM" }, null, (response) => {
          clearTimeout(timeout);
          resolve(response);
        });
      });
    }
  };
}

const SINGLE_RENDERED_BLOCK =
  "0:01 Planning habits improve focus through review execution and clear priorities for practical weekly work.";

test("DOM extraction accepts one substantial transcript block and removes its timestamp", async () => {
  const harness = createContentScriptHarness({ transcriptText: SINGLE_RENDERED_BLOCK });

  const response = await harness.extractTranscript();

  assert.equal(response.ok, true);
  assert.match(response.transcript, /^Planning habits improve focus/);
  assert.doesNotMatch(response.transcript, /^0:01/);
});

test("DOM fallback reads transcript text exposed immediately after opening the panel", async () => {
  const harness = createContentScriptHarness({
    transcriptText: SINGLE_RENDERED_BLOCK,
    revealAfterClick: true
  });

  const response = await harness.extractTranscript();

  assert.equal(harness.showTranscriptButton.clicked, true);
  assert.equal(response.ok, true);
  assert.match(response.transcript, /clear priorities/);
});

test("DOM fallback waits for transcript rows rendered after the panel opens", async () => {
  const harness = createContentScriptHarness({
    transcriptText: SINGLE_RENDERED_BLOCK,
    revealAfterClick: true,
    useModernSegment: true,
    transcriptRevealDelayMs: 50
  });

  const response = await harness.extractTranscript();

  assert.equal(harness.showTranscriptButton.clicked, true);
  assert.equal(response.ok, true);
  assert.match(response.transcript, /clear priorities/);
});

test("DOM extraction reads YouTube's modern transcript segment view model", async () => {
  const harness = createContentScriptHarness({
    transcriptText: SINGLE_RENDERED_BLOCK,
    useModernSegment: true
  });

  const response = await harness.extractTranscript();

  assert.equal(response.ok, true);
  assert.match(response.transcript, /^Planning habits improve focus/);
});

test("DOM fallback expands the description before opening a localized transcript button", async () => {
  const harness = createContentScriptHarness({
    transcriptText: SINGLE_RENDERED_BLOCK,
    revealAfterClick: true,
    revealButtonAfterDescriptionExpand: true,
    useModernSegment: true
  });
  harness.showTranscriptButton.innerText = "Wyświetl transkrypcję";
  harness.showTranscriptButton.textContent = "Wyświetl transkrypcję";

  const response = await harness.extractTranscript();

  assert.equal(harness.expandDescriptionButton.clicked, true);
  assert.equal(harness.showTranscriptButton.clicked, true);
  assert.equal(response.ok, true);
  assert.match(response.transcript, /clear priorities/);
});
