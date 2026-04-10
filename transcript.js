/**
 * Fetches and cleans transcript text from YouTube caption tracks.
 */
export async function getTranscript(videoId, tabId) {
  if (!videoId) {
    throw new Error("Missing video ID.");
  }

  const watchUrl = `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}&hl=en`;
  const watchResponse = await fetch(watchUrl, { credentials: "include" });

  if (!watchResponse.ok) {
    throw new Error(`Failed to load YouTube page (${watchResponse.status}).`);
  }

  const html = await watchResponse.text();
  const playerResponse = extractPlayerResponse(html);
  const tracks = playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks;

  if (!Array.isArray(tracks) || tracks.length === 0) {
    throw new Error("Transcript unavailable for this video.");
  }

  const orderedTracks = orderTracksByPreference(tracks);
  let transcript = "";
  let lastError = "";

  for (const track of orderedTracks) {
    try {
      transcript = await downloadTrackTranscript(track.baseUrl);
      if (transcript) break;
    } catch (error) {
      lastError = error instanceof Error ? error.message : "Unknown caption track error";
    }
  }

  if (!transcript) {
    transcript = await downloadViaTimedtextFallback(videoId, orderedTracks);
  }

  if (!transcript && Number.isInteger(tabId)) {
    transcript = await downloadFromPageContext(tabId);
  }

  if (!transcript) {
    const reason = lastError || "No accessible caption payload from track URLs, timedtext fallback, or page-context fallback.";
    throw new Error(`Transcript unavailable for this video. ${reason}`);
  }

  return transcript;
}

async function downloadFromPageContext(tabId) {
  if (!chrome?.scripting) return "";

  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func: async () => {
        function orderTracks(tracks) {
          const english = tracks.filter((t) => t.languageCode === "en");
          const englishVariants = tracks.filter((t) => t.languageCode?.startsWith("en-"));
          const others = tracks.filter(
            (t) => t.languageCode !== "en" && !t.languageCode?.startsWith("en-")
          );
          return [...english, ...englishVariants, ...others];
        }

        function parseJson3(data) {
          const events = Array.isArray(data?.events) ? data.events : [];
          const lines = [];
          const decoder = document.createElement("textarea");

          for (const event of events) {
            if (!Array.isArray(event?.segs)) continue;
            const rawLine = event.segs.map((seg) => seg.utf8 || "").join("");
            decoder.innerHTML = rawLine;
            const cleanLine = decoder.value.replace(/\s+/g, " ").trim();
            if (cleanLine) lines.push(cleanLine);
          }

          return lines.join("\n").trim();
        }

        function parseXml(xmlText) {
          const parser = new DOMParser();
          const xml = parser.parseFromString(xmlText, "text/xml");
          if (xml.querySelector("parsererror")) return "";

          const textNodes = Array.from(xml.querySelectorAll("text, p"));
          if (textNodes.length === 0) return "";

          return textNodes
            .map((node) => (node.textContent || "").replace(/\s+/g, " ").trim())
            .filter(Boolean)
            .join("\n")
            .trim();
        }

        function parseVtt(vttText) {
          if (!vttText.includes("WEBVTT")) return "";

          const lines = vttText
            .split("\n")
            .map((line) => line.trim())
            .filter((line) => {
              if (!line) return false;
              if (line === "WEBVTT") return false;
              if (/^\d+$/.test(line)) return false;
              if (
                /^\d{2}:\d{2}:\d{2}\.\d{3}\s+-->\s+\d{2}:\d{2}:\d{2}\.\d{3}/.test(line)
              ) {
                return false;
              }
              if (/^NOTE\b/.test(line)) return false;
              return true;
            });

          return lines.join("\n").replace(/\s+/g, " ").trim();
        }

        function parsePayload(raw) {
          try {
            const json = JSON.parse(raw);
            const parsedJson = parseJson3(json);
            if (parsedJson) return parsedJson;
          } catch (_error) {
            // Not JSON.
          }

          const parsedXml = parseXml(raw);
          if (parsedXml) return parsedXml;

          return parseVtt(raw);
        }

        function captionCandidates(baseUrl) {
          const original = new URL(baseUrl);
          const json3 = new URL(baseUrl);
          json3.searchParams.set("fmt", "json3");
          const vtt = new URL(baseUrl);
          vtt.searchParams.set("fmt", "vtt");
          return [original.toString(), json3.toString(), vtt.toString()];
        }

        const player =
          window.ytInitialPlayerResponse ||
          (() => {
            try {
              const raw = window.ytplayer?.config?.args?.player_response;
              return raw ? JSON.parse(raw) : null;
            } catch (_error) {
              return null;
            }
          })();

        const tracks = player?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
        if (!Array.isArray(tracks) || tracks.length === 0) return "";

        const ordered = orderTracks(tracks);
        for (const track of ordered) {
          for (const url of captionCandidates(track.baseUrl)) {
            try {
              const response = await fetch(url, { credentials: "include" });
              if (!response.ok) continue;
              const raw = await response.text();
              if (!raw.trim()) continue;
              const transcript = parsePayload(raw);
              if (transcript) return transcript;
            } catch (_error) {
              // Try next URL.
            }
          }
        }

        return "";
      }
    });

    const transcript = results?.[0]?.result;
    return typeof transcript === "string" ? transcript.trim() : "";
  } catch (_error) {
    return "";
  }
}

function orderTracksByPreference(tracks) {
  const preferred = [];
  const english = tracks.filter((t) => t.languageCode === "en");
  const englishVariants = tracks.filter((t) => t.languageCode?.startsWith("en-"));
  const others = tracks.filter(
    (t) => t.languageCode !== "en" && !t.languageCode?.startsWith("en-")
  );

  preferred.push(...english, ...englishVariants, ...others);
  return preferred;
}

async function downloadTrackTranscript(baseUrl) {
  const candidates = buildCaptionUrlCandidates(baseUrl);
  let lastError = "";

  for (const candidate of candidates) {
    try {
      const response = await fetch(candidate, { credentials: "include" });
      if (!response.ok) {
        lastError = `Failed to fetch captions (${response.status})`;
        continue;
      }

      const raw = await response.text();
      if (!raw.trim()) {
        lastError = "Caption track returned an empty response";
        continue;
      }

      const transcript = parseCaptionPayload(raw);
      if (transcript) return transcript;
      lastError = "Could not parse caption track response";
    } catch (error) {
      lastError = error instanceof Error ? error.message : "Unknown caption fetch error";
    }
  }

  throw new Error(lastError || "Transcript unavailable for this video.");
}

function buildCaptionUrlCandidates(baseUrl) {
  const base = new URL(baseUrl);
  const original = new URL(base.toString());

  const json3 = new URL(base.toString());
  json3.searchParams.set("fmt", "json3");

  const vtt = new URL(base.toString());
  vtt.searchParams.set("fmt", "vtt");

  return [original.toString(), json3.toString(), vtt.toString()];
}

async function downloadViaTimedtextFallback(videoId, tracks) {
  for (const track of tracks) {
    const candidates = buildTimedtextCandidates(videoId, track);

    for (const url of candidates) {
      try {
        const response = await fetch(url, { credentials: "include" });
        if (!response.ok) continue;

        const raw = await response.text();
        if (!raw.trim()) continue;

        const transcript = parseCaptionPayload(raw);
        if (transcript) return transcript;
      } catch (_error) {
        // Try next fallback URL.
      }
    }
  }

  return "";
}

function buildTimedtextCandidates(videoId, track) {
  const lang = track?.languageCode || "";
  const name = track?.name?.simpleText || track?.name?.runs?.map((x) => x?.text || "").join("") || "";
  const kind = track?.kind || "";
  const vssId = track?.vssId || "";

  if (!lang) return [];

  const baseParams = new URLSearchParams({
    v: videoId,
    lang
  });

  if (name) baseParams.set("name", name);
  if (kind) baseParams.set("kind", kind);
  if (vssId) baseParams.set("vssid", vssId);

  const candidates = [];

  const base = new URL("https://www.youtube.com/api/timedtext");
  base.search = baseParams.toString();
  candidates.push(base.toString());

  const json3 = new URL(base.toString());
  json3.searchParams.set("fmt", "json3");
  candidates.push(json3.toString());

  const vtt = new URL(base.toString());
  vtt.searchParams.set("fmt", "vtt");
  candidates.push(vtt.toString());

  const srv3 = new URL(base.toString());
  srv3.searchParams.set("fmt", "srv3");
  candidates.push(srv3.toString());

  if (kind !== "asr") {
    const asr = new URL(base.toString());
    asr.searchParams.set("kind", "asr");
    candidates.push(asr.toString());

    const asrJson3 = new URL(asr.toString());
    asrJson3.searchParams.set("fmt", "json3");
    candidates.push(asrJson3.toString());
  }

  return Array.from(new Set(candidates));
}

function parseCaptionPayload(raw) {
  try {
    const data = JSON.parse(raw);
    const jsonTranscript = extractTranscriptFromJson3(data);
    if (jsonTranscript) return jsonTranscript;
  } catch (_parseError) {
    // Not JSON, continue with XML/VTT parsers.
  }

  const xmlTranscript = extractTranscriptFromXml(raw);
  if (xmlTranscript) return xmlTranscript;

  const vttTranscript = extractTranscriptFromVtt(raw);
  if (vttTranscript) return vttTranscript;

  return "";
}

function extractTranscriptFromJson3(data) {
  const events = Array.isArray(data?.events) ? data.events : [];
  const lines = [];
  const decoder = document.createElement("textarea");

  for (const event of events) {
    if (!Array.isArray(event?.segs)) continue;
    const rawLine = event.segs.map((seg) => seg.utf8 || "").join("");
    const cleanLine = decodeEntities(rawLine, decoder).replace(/\s+/g, " ").trim();
    if (cleanLine) lines.push(cleanLine);
  }

  return lines.join("\n").trim();
}

function extractTranscriptFromXml(xmlText) {
  const parser = new DOMParser();
  const xml = parser.parseFromString(xmlText, "text/xml");
  if (xml.querySelector("parsererror")) return "";

  const textNodes = Array.from(xml.querySelectorAll("text, p"));
  if (textNodes.length === 0) return "";

  const lines = textNodes
    .map((node) => (node.textContent || "").replace(/\s+/g, " ").trim())
    .filter(Boolean);

  return lines.join("\n").trim();
}

function extractTranscriptFromVtt(vttText) {
  if (!vttText.includes("WEBVTT")) return "";

  const lines = vttText
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => {
      if (!line) return false;
      if (line === "WEBVTT") return false;
      if (/^\d+$/.test(line)) return false;
      if (/^\d{2}:\d{2}:\d{2}\.\d{3}\s+-->\s+\d{2}:\d{2}:\d{2}\.\d{3}/.test(line)) return false;
      if (/^NOTE\b/.test(line)) return false;
      return true;
    });

  return lines.join("\n").replace(/\s+/g, " ").trim();
}

function decodeEntities(text, decoder) {
  decoder.innerHTML = text;
  return decoder.value;
}

function extractPlayerResponse(html) {
  const marker = "ytInitialPlayerResponse = ";
  const markerIndex = html.indexOf(marker);

  if (markerIndex === -1) {
    throw new Error("Unable to locate player response in YouTube page.");
  }

  const jsonStart = html.indexOf("{", markerIndex);
  if (jsonStart === -1) {
    throw new Error("Malformed player response.");
  }

  const jsonText = extractBalancedJson(html, jsonStart);
  return JSON.parse(jsonText);
}

function extractBalancedJson(text, startIndex) {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = startIndex; i < text.length; i++) {
    const ch = text[i];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === "\"") {
        inString = false;
      }
      continue;
    }

    if (ch === "\"") {
      inString = true;
      continue;
    }

    if (ch === "{") depth++;
    if (ch === "}") depth--;

    if (depth === 0) {
      return text.slice(startIndex, i + 1);
    }
  }

  throw new Error("Could not parse player response JSON.");
}
