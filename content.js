if (!window.__smartWatchContentScriptInitialized) {
  window.__smartWatchContentScriptInitialized = true;

  function getVideoContext() {
    const url = new URL(window.location.href);
    const videoId = url.searchParams.get("v");
    const isWatchPage =
      url.hostname === "www.youtube.com" && url.pathname === "/watch" && Boolean(videoId);

    return {
      isWatchPage,
      videoId: videoId || "",
      url: window.location.href
    };
  }

  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function normalizeText(value) {
    return (value || "").replace(/\s+/g, " ").trim();
  }

  function getNodeText(node) {
    return normalizeText(node?.innerText || node?.textContent || "");
  }

  function removeLeadingTimestamp(value) {
    return normalizeText(value)
      .replace(/^(?:(?:\d{1,2}:)?\d{1,2}:\d{2}\s*)+/, "")
      .trim();
  }

  function isTimestampLike(text) {
    return /^(\d{1,2}:)?\d{1,2}:\d{2}$/.test(text);
  }

  function isUiNoise(text) {
    const normalized = text.toLowerCase();
    return (
      normalized === "transcript" ||
      normalized === "show transcript" ||
      normalized === "search in transcript" ||
      normalized === "transcript search"
    );
  }

  function uniqueNonNoiseLines(nodes) {
    return Array.from(
      new Set(
        nodes
          .map((node) => removeLeadingTimestamp(getNodeText(node)))
          .filter((text) => text && !isTimestampLike(text) && !isUiNoise(text))
      )
    );
  }

  function uniqueNonNoiseStrings(values) {
    return Array.from(
      new Set(
        values
          .map((value) => removeLeadingTimestamp(value))
          .filter((text) => text && !isTimestampLike(text) && !isUiNoise(text))
      )
    );
  }

  function buildUsableTranscript(values) {
    const lines = uniqueNonNoiseStrings(values);
    const transcript = lines.join("\n").trim();
    if (transcript.length < 40) return "";

    const words = transcript.split(/\s+/).filter(Boolean);
    if (words.length < 8) return "";

    const uniqueWords = new Set(words.map((word) => word.toLowerCase()));
    return uniqueWords.size >= 6 ? transcript : "";
  }

  function isLikelyVisible(element) {
    if (!(element instanceof Element)) return false;
    if (element.hidden || element.closest?.("[hidden], [aria-hidden='true']")) return false;
    const style = window.getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden") return false;
    if (typeof element.getClientRects === "function" && element.getClientRects().length === 0) {
      return false;
    }
    return true;
  }

  function collectLeafTextFromContainer(container) {
    const candidates = Array.from(
      container.querySelectorAll(
        "yt-formatted-string, span, div, p, li, h1, h2, h3, h4, h5, h6"
      )
    ).filter((element) => {
      if (!isLikelyVisible(element)) return false;
      if (element.childElementCount > 0) return false;
      return true;
    });

    const directLeafLines = uniqueNonNoiseStrings(candidates.map((node) => getNodeText(node))).filter(
      (text) => text.length > 3
    );
    if (buildUsableTranscript(directLeafLines)) {
      return directLeafLines;
    }

    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!node.nodeValue || !node.parentElement || !isLikelyVisible(node.parentElement)) {
          return NodeFilter.FILTER_REJECT;
        }

        const text = normalizeText(node.nodeValue);
        if (!text || isTimestampLike(text) || isUiNoise(text)) {
          return NodeFilter.FILTER_REJECT;
        }

        return NodeFilter.FILTER_ACCEPT;
      }
    });

    const textNodes = [];
    let currentNode = walker.nextNode();
    while (currentNode) {
      textNodes.push(currentNode.nodeValue || "");
      currentNode = walker.nextNode();
    }

    return uniqueNonNoiseStrings(textNodes).filter((text) => text.length > 3);
  }

  function collectTranscriptFromDom() {
    const segmentSelectors = [
      "transcript-segment-view-model [role='text']",
      "transcript-segment-view-model yt-attributed-string",
      "ytd-transcript-segment-renderer [id='segment-text']",
      "ytd-transcript-segment-renderer #segment-text",
      "ytd-transcript-segment-renderer yt-formatted-string[role='text']",
      "ytd-transcript-segment-renderer yt-formatted-string",
      "ytd-transcript-segment-renderer span",
      "ytd-transcript-segment-renderer div",
      "ytd-transcript-segment-renderer yt-formatted-string.segment-text",
      "ytd-transcript-segment-renderer .segment-text",
      "ytd-transcript-segment-renderer [class*='segment-text']",
      "ytd-transcript-renderer ytd-transcript-segment-renderer #segment-text",
      "ytd-transcript-search-panel-renderer ytd-transcript-segment-renderer #segment-text",
      "ytd-transcript-renderer [role='listitem'] yt-formatted-string",
      "ytd-transcript-search-panel-renderer [role='listitem'] yt-formatted-string",
      "ytd-transcript-segment-list-renderer [id='segment-text']",
      "ytd-transcript-segment-list-renderer [class*='segment-text']",
      "ytd-transcript-segment-list-renderer [role='listitem']",
      "#segments-container [id='segment-text']",
      "#segments-container [class*='segment-text']",
      "#segments-container [role='listitem']"
    ];

    for (const selector of segmentSelectors) {
      const found = Array.from(document.querySelectorAll(selector)).filter((element) =>
        isLikelyVisible(element)
      );
      if (found.length > 0) {
        const lines = uniqueNonNoiseLines(found);
        const transcript = buildUsableTranscript(lines);

        if (transcript) {
          return transcript;
        }
      }
    }

    const transcriptRenderers = Array.from(
      document.querySelectorAll(
        "ytd-transcript-renderer ytd-transcript-segment-renderer, " +
          "ytd-transcript-search-panel-renderer ytd-transcript-segment-renderer, " +
          "ytd-transcript-segment-list-renderer ytd-transcript-segment-renderer"
      )
    ).filter((element) => isLikelyVisible(element));
    const rendererLines = uniqueNonNoiseLines(transcriptRenderers).filter((text) => text.length > 8);
    const rendererTranscript = buildUsableTranscript(rendererLines);
    if (rendererTranscript) return rendererTranscript;

    const transcriptContainers = Array.from(
      document.querySelectorAll(
        [
          "ytd-transcript-renderer",
          "ytd-transcript-search-panel-renderer",
          "ytd-transcript-segment-list-renderer",
          "#segments-container",
          "ytd-engagement-panel-section-list-renderer[target-id*='transcript']",
          "[target-id*='transcript']",
          "[data-target-id*='transcript']",
          "[aria-label*='transcript' i]"
        ].join(", ")
      )
    ).filter((container) => isLikelyVisible(container));

    for (const container of transcriptContainers) {
      const segmentCandidates = Array.from(
        container.querySelectorAll(
          [
            "[id='segment-text']",
            "[class*='segment-text']",
            "ytd-transcript-segment-renderer",
            "[role='listitem']"
          ].join(", ")
        )
      );
      const segmentTranscript = buildUsableTranscript(
        uniqueNonNoiseLines(segmentCandidates)
      );
      if (segmentTranscript) return segmentTranscript;

      const leafLines = collectLeafTextFromContainer(container).filter((text) => text.length > 3);
      const leafTranscript = buildUsableTranscript(leafLines);
      if (leafTranscript) return leafTranscript;

      const lines = (container.innerText || container.textContent || "")
        .split(/\n+/)
        .map((text) => removeLeadingTimestamp(text))
        .filter((text) => text && !isTimestampLike(text) && !isUiNoise(text) && text.length > 3);
      const containerTranscript = buildUsableTranscript(lines);
      if (containerTranscript) return containerTranscript;
    }

    return "";
  }

  function matchesTranscriptControl(element) {
    const label = normalizeText(
      `${getNodeText(element)} ${element?.getAttribute?.("aria-label") || ""}`
    );
    return /\btranscript\b|transkrypcj/i.test(label);
  }

  function findDirectTranscriptButton() {
    const scopedButtons = Array.from(
      document.querySelectorAll(
        "ytd-video-description-transcript-section-renderer button, " +
          "ytd-video-description-transcript-section-renderer tp-yt-paper-button"
      )
    );
    const allButtons = Array.from(document.querySelectorAll("button, tp-yt-paper-button"));

    return [...scopedButtons, ...allButtons].find((element) => {
      if (!isLikelyVisible(element) || !matchesTranscriptControl(element)) return false;
      const label = normalizeText(
        `${getNodeText(element)} ${element.getAttribute("aria-label") || ""}`
      ).toLowerCase();
      return !/(close|hide|zamknij|ukryj)/i.test(label);
    });
  }

  function expandVideoDescription() {
    const expandButtons = Array.from(
      document.querySelectorAll(
        [
          "ytd-watch-metadata ytd-text-inline-expander #expand",
          "ytd-watch-metadata #description #expand",
          "ytd-text-inline-expander tp-yt-paper-button#expand"
        ].join(", ")
      )
    );
    const expandButton = expandButtons.find((element) => isLikelyVisible(element));
    if (!expandButton) return false;

    expandButton.click();
    return true;
  }

  async function clickShowTranscriptMenuItem() {
    let directTranscriptButton = findDirectTranscriptButton();
    if (directTranscriptButton) {
      directTranscriptButton.click();
      return true;
    }

    if (expandVideoDescription()) {
      await delay(250);
      directTranscriptButton = findDirectTranscriptButton();
      if (directTranscriptButton) {
        directTranscriptButton.click();
        return true;
      }
    }

    const moreButtons = Array.from(
      document.querySelectorAll(
        [
          "ytd-watch-metadata #actions button",
          "ytd-watch-metadata #actions yt-icon-button",
          "#top-level-buttons-computed button",
          "#top-level-buttons-computed yt-icon-button"
        ].join(", ")
      )
    );
    const moreActionsButton = moreButtons.find((el) => {
      const label = (el.getAttribute("aria-label") || "").toLowerCase();
      return (
        isLikelyVisible(el) &&
        (label.includes("more actions") || label.includes("więcej działań"))
      );
    });

    if (!moreActionsButton) return false;

    moreActionsButton.click();
    await delay(350);

    const menuItems = Array.from(
      document.querySelectorAll("ytd-menu-service-item-renderer, tp-yt-paper-item")
    );
    const transcriptItem = menuItems.find((item) => matchesTranscriptControl(item));

    if (!transcriptItem) return false;
    transcriptItem.click();
    return true;
  }

  function waitForTranscriptFromDom(timeoutMs = 20000) {
    const immediate = collectTranscriptFromDom();
    if (immediate) return Promise.resolve(immediate);

    return new Promise((resolve) => {
      let finished = false;
      let intervalId;
      let timeoutId;

      const observer = new MutationObserver(() => check());

      function finish(transcript) {
        if (finished) return;
        finished = true;
        observer.disconnect();
        clearInterval(intervalId);
        clearTimeout(timeoutId);
        resolve(transcript);
      }

      function check() {
        const transcript = collectTranscriptFromDom();
        if (transcript) finish(transcript);
      }

      observer.observe(document.body || document.documentElement, {
        childList: true,
        subtree: true,
        characterData: true
      });
      intervalId = setInterval(check, 400);
      timeoutId = setTimeout(() => finish(""), timeoutMs);
    });
  }

  async function extractTranscriptViaDom() {
    const initial = collectTranscriptFromDom();
    if (initial) return initial;

    const opened = await clickShowTranscriptMenuItem();
    if (!opened) {
      throw new Error("Could not find the transcript menu option on this page.");
    }

    const transcript = await waitForTranscriptFromDom();
    if (transcript) return transcript;

    console.debug("[SmartWatch] Transcript panel opened, but readable DOM segments were not detected.");
    throw new Error("Transcript panel opened, but its text could not be read from the current YouTube layout.");
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "GET_VIDEO_CONTEXT") {
      sendResponse(getVideoContext());
      return;
    }

    if (message?.type === "EXTRACT_TRANSCRIPT_DOM") {
      extractTranscriptViaDom()
        .then((transcript) => sendResponse({ ok: true, transcript }))
        .catch((error) =>
          sendResponse({
            ok: false,
            error: error instanceof Error ? error.message : "Failed to extract transcript from page."
          })
        );
      return true;
    }
  });
}
