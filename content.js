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
          .map((node) => normalizeText(node.textContent))
          .filter((text) => text && !isTimestampLike(text) && !isUiNoise(text))
      )
    );
  }

  function uniqueNonNoiseStrings(values) {
    return Array.from(
      new Set(values.map((value) => normalizeText(value)).filter((text) => text && !isTimestampLike(text) && !isUiNoise(text)))
    );
  }

  function isLikelyVisible(element) {
    if (!(element instanceof Element)) return false;
    const style = window.getComputedStyle(element);
    return style.display !== "none" && style.visibility !== "hidden";
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

    const directLeafLines = uniqueNonNoiseStrings(candidates.map((node) => node.textContent || "")).filter(
      (text) => text.length > 3
    );
    if (directLeafLines.length >= 3) {
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
      "ytd-transcript-search-panel-renderer [role='listitem'] yt-formatted-string"
    ];

    for (const selector of segmentSelectors) {
      const found = Array.from(document.querySelectorAll(selector));
      if (found.length > 0) {
        const lines = uniqueNonNoiseLines(found);

        if (lines.length >= 3) {
          return lines.join("\n").trim();
        }
      }
    }

    const transcriptRenderers = Array.from(
      document.querySelectorAll("ytd-transcript-renderer ytd-transcript-segment-renderer")
    );
    const rendererLines = uniqueNonNoiseLines(transcriptRenderers).filter((text) => text.length > 8);
    if (rendererLines.length >= 3) {
      return rendererLines.join("\n").trim();
    }

    const transcriptContainers = Array.from(
      document.querySelectorAll(
        [
          "ytd-transcript-renderer",
          "ytd-transcript-search-panel-renderer",
          "ytd-engagement-panel-section-list-renderer[target-id*='transcript']",
          "[target-id*='transcript']",
          "[aria-label*='Transcript']",
          "[aria-label*='transcript']"
        ].join(", ")
      )
    ).filter((container) => isLikelyVisible(container));

    for (const container of transcriptContainers) {
      const leafLines = collectLeafTextFromContainer(container).filter((text) => text.length > 3);
      if (leafLines.length >= 3) {
        return Array.from(new Set(leafLines)).join("\n").trim();
      }

      const lines = (container.textContent || "")
        .split(/\n+/)
        .map((text) => normalizeText(text))
        .filter((text) => text && !isTimestampLike(text) && !isUiNoise(text) && text.length > 3);

      if (lines.length >= 5) {
        return Array.from(new Set(lines)).join("\n").trim();
      }
    }

    return "";
  }

  async function clickShowTranscriptMenuItem() {
    const textMatch = /(show transcript|transcript|pokaż transkrypcję|transkrypcja)/i;

    const directButtons = Array.from(document.querySelectorAll("button, tp-yt-paper-button"));
    const directTranscriptButton = directButtons.find((el) =>
      textMatch.test((el.textContent || "").trim())
    );
    if (directTranscriptButton) {
      directTranscriptButton.click();
      return true;
    }

    const moreButtons = Array.from(document.querySelectorAll("button, yt-icon-button"));
    const moreActionsButton = moreButtons.find((el) => {
      const label = (el.getAttribute("aria-label") || "").toLowerCase();
      return label.includes("more actions") || label.includes("więcej") || label.includes("more");
    });

    if (!moreActionsButton) return false;

    moreActionsButton.click();
    await delay(350);

    const menuItems = Array.from(
      document.querySelectorAll("ytd-menu-service-item-renderer, tp-yt-paper-item")
    );
    const transcriptItem = menuItems.find((item) =>
      textMatch.test((item.textContent || "").replace(/\s+/g, " ").trim())
    );

    if (!transcriptItem) return false;
    transcriptItem.click();
    return true;
  }

  async function extractTranscriptViaDom() {
    const initial = collectTranscriptFromDom();
    if (initial) return initial;

    const opened = await clickShowTranscriptMenuItem();
    if (!opened) {
      throw new Error("Could not find the transcript menu option on this page.");
    }

    for (let i = 0; i < 30; i++) {
      await delay(300);
      const transcript = collectTranscriptFromDom();
      if (transcript) return transcript;
    }

    throw new Error("Transcript panel opened, but no transcript text was found.");
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
