chrome.runtime.onInstalled.addListener(async () => {
  await ensurePanelBehavior();
  await refreshAllTabs();
});

chrome.runtime.onStartup.addListener(async () => {
  await ensurePanelBehavior();
  await refreshAllTabs();
});

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  await refreshTab(tabId);
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status !== "complete" && !changeInfo.url) return;
  await setPanelForTab(tabId, changeInfo.url || tab.url);
});

chrome.webNavigation.onCommitted.addListener(async ({ tabId, frameId, url }) => {
  if (frameId !== 0) return;
  await setPanelForTab(tabId, url);
});

chrome.webNavigation.onHistoryStateUpdated.addListener(async ({ tabId, frameId, url }) => {
  if (frameId !== 0) return;
  await setPanelForTab(tabId, url);
});

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab?.id) return;

  await setPanelForTab(tab.id, tab.url);

  if (!isWatchPageUrl(tab.url)) {
    return;
  }

  try {
    await chrome.sidePanel.open({ windowId: tab.windowId });
  } catch (error) {
    console.error("Failed to open side panel:", error);
  }
});

async function ensurePanelBehavior() {
  try {
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  } catch (error) {
    console.error("Failed to set side panel behavior:", error);
  }
}

async function refreshAllTabs() {
  const tabs = await chrome.tabs.query({});
  await Promise.all(tabs.map((tab) => refreshTab(tab.id)));
}

async function refreshTab(tabId) {
  if (!Number.isInteger(tabId)) return;

  try {
    const tab = await chrome.tabs.get(tabId);
    await setPanelForTab(tabId, tab.url);
  } catch (error) {
    console.error("Failed to refresh side panel state:", error);
  }
}

async function setPanelForTab(tabId, url) {
  const isWatchPage = isWatchPageUrl(url);

  try {
    await chrome.sidePanel.setOptions({
      tabId,
      path: "sidepanel.html",
      enabled: isWatchPage
    });
  } catch (error) {
    console.error("Failed to update side panel options:", error);
  }
}

function isWatchPageUrl(url) {
  if (typeof url !== "string") return false;

  try {
    const parsed = new URL(url);
    const isYouTubeHost =
      parsed.hostname === "www.youtube.com" || parsed.hostname === "m.youtube.com";

    return isYouTubeHost && parsed.pathname === "/watch" && parsed.searchParams.has("v");
  } catch (_error) {
    return false;
  }
}
