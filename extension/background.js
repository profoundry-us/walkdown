/*
 * The toolbar button is the whole interface: click it to walk this site down,
 * click it again to stop. Everything else — which server, which blueprint —
 * is asked in the panel, where there is room to explain it and where you can
 * see what you are choosing between.
 *
 * A popup for two settings that the panel already presents better was just a
 * second place to look.
 */
const SITES = 'walkdown:sites';

const originOf = (url) => {
  try {
    const u = new URL(url);
    return /^https?:$/.test(u.protocol) ? u.origin : null;
  } catch {
    return null;
  }
};

const readSites = async () => (await chrome.storage.local.get(SITES))[SITES] ?? {};

/*
 * Without a popup there is no other place to see whether walkdown is on, so
 * the button says so itself — per tab, because the answer is per origin. The
 * icon carries it rather than a badge: a badge is a notice pinned to a button,
 * and this is a state the button is in.
 */
async function paint(tabId, origin) {
  const sites = await readSites();
  const on = Boolean(origin && sites[origin]?.on);
  try {
    await chrome.action.setIcon({
      tabId,
      path: { 128: on ? 'icons/icon-128.png' : 'icons/icon-128-off.png' },
    });
    await chrome.action.setTitle({
      tabId,
      title: origin
        ? on ? `walkdown is on for ${origin} — click to stop` : `walkdown — click to walk ${origin} down`
        : 'walkdown runs on http and https pages',
    });
  } catch {
    // the tab went away mid-flight; nothing to paint
  }
}

chrome.action.onClicked.addListener(async (tab) => {
  const origin = originOf(tab.url);
  if (!origin) return;
  const sites = await readSites();
  const next = { ...sites };
  // Off is absence, not a stored false — a site walkdown has never been turned
  // on for and one it has been turned off for are the same thing.
  if (sites[origin]?.on) delete next[origin];
  else next[origin] = { ...(sites[origin] ?? {}), on: true };
  await chrome.storage.local.set({ [SITES]: next });
  await paint(tab.id, origin);
  chrome.tabs.reload(tab.id);
});

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  try {
    const tab = await chrome.tabs.get(tabId);
    paint(tabId, originOf(tab.url));
  } catch { /* gone */ }
});

chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (info.status === 'loading' || info.url) paint(tabId, originOf(tab.url));
});
