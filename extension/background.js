/*
 * The toolbar button is the whole interface: click it to walk this page down,
 * click it again to go back to it. Everything else — which server, which
 * blueprint — is asked in the panel, where there is room to explain it.
 *
 * Walking a page down means opening it inside walkdown's own page, framed. The
 * two things only an extension can do are what make that possible: take the
 * headers off a response that refuses to be framed, and put the embed inside
 * the frame once it loads.
 */
const REVIEWS = 'walkdown:reviews'; // tabId -> the url being reviewed
const RULE_BASE = 9000; // one session rule per reviewed tab

const httpOrigin = (url) => {
  try {
    const u = new URL(url);
    return /^https?:$/.test(u.protocol) ? u : null;
  } catch {
    return null;
  }
};

const reviewPage = chrome.runtime.getURL('review.html');
const reviewedUrl = (url) =>
  url?.startsWith(reviewPage) ? decodeURIComponent(new URL(url).hash.slice(1)) : null;

const readReviews = async () => (await chrome.storage.session.get(REVIEWS))[REVIEWS] ?? {};
const writeReviews = (next) => chrome.storage.session.set({ [REVIEWS]: next });

/*
 * X-Frame-Options and a frame-ancestors directive are how a site says "do not
 * put me in a frame". Reviewing is exactly that, so the header comes off — but
 * only for frames inside the one tab doing the reviewing, and only while it is
 * doing it. Session rules take a tab id; static ones cannot, which is why
 * these are added and dropped as reviews start and end rather than declared
 * once and left standing over every tab.
 */
async function allowFraming(tabId, on) {
  const id = RULE_BASE + (tabId % 1000);
  try {
    await chrome.declarativeNetRequest.updateSessionRules({
      removeRuleIds: [id],
      addRules: on
        ? [
            {
              id,
              priority: 1,
              action: {
                type: 'modifyHeaders',
                responseHeaders: [
                  { header: 'x-frame-options', operation: 'remove' },
                  // DNR can only take a whole header, and frame-ancestors lives
                  // inside CSP — so the policy goes for the framed request. It is
                  // scoped to this tab and ends with the review.
                  { header: 'content-security-policy', operation: 'remove' },
                  { header: 'content-security-policy-report-only', operation: 'remove' },
                ],
              },
              condition: { tabIds: [tabId], resourceTypes: ['sub_frame'] },
            },
          ]
        : [],
    });
  } catch (err) {
    console.warn('[walkdown] could not update framing rules:', err);
  }
}

/*
 * Without a popup there is no other place to see whether walkdown is on, so
 * the button says so itself. The icon carries it rather than a badge: a badge
 * is a notice pinned to a button, and this is a state the button is in.
 */
async function paint(tabId, url) {
  const on = Boolean(reviewedUrl(url));
  const here = httpOrigin(url);
  try {
    await chrome.action.setIcon({
      tabId,
      path: { 128: on ? 'icons/icon-128.png' : 'icons/icon-128-off.png' },
    });
    await chrome.action.setTitle({
      tabId,
      title: on
        ? 'walking this page down — click to go back to it'
        : here
          ? `walkdown — click to walk ${here.origin} down`
          : 'walkdown runs on http and https pages',
    });
  } catch {
    // the tab went away mid-flight; nothing to paint
  }
}

chrome.action.onClicked.addListener(async (tab) => {
  const back = reviewedUrl(tab.url);
  const reviews = await readReviews();
  if (back) {
    // Turning it off means going back to the page itself, at the URL it is
    // actually on — not to wherever the review started.
    delete reviews[tab.id];
    await writeReviews(reviews);
    await allowFraming(tab.id, false);
    return chrome.tabs.update(tab.id, { url: back });
  }
  const here = httpOrigin(tab.url);
  if (!here) return;
  reviews[tab.id] = tab.url;
  await writeReviews(reviews);
  await allowFraming(tab.id, true);
  chrome.tabs.update(tab.id, { url: `${reviewPage}#${encodeURIComponent(tab.url)}` });
});

/*
 * The frame asks what it is. Only frames inside a tab that is reviewing get
 * the embed, and the top frame of such a tab is walkdown's own page, which
 * content scripts never run on — so this answers for the application itself.
 */
chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (msg?.type !== 'walkdown:role') return;
  readReviews().then((reviews) => {
    reply({ role: sender.tab?.id != null && reviews[sender.tab.id] ? 'embed' : 'none' });
  });
  return true; // the answer is async
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  const reviews = await readReviews();
  if (!reviews[tabId]) return;
  delete reviews[tabId];
  await writeReviews(reviews);
  allowFraming(tabId, false);
});

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  try {
    const tab = await chrome.tabs.get(tabId);
    paint(tabId, tab.url);
  } catch {
    /* gone */
  }
});

chrome.tabs.onUpdated.addListener(async (tabId, info, tab) => {
  if (info.status !== 'loading' && !info.url) return;
  paint(tabId, tab.url);
  // Navigated away from the review page by hand: the review is over, and the
  // headers go back on.
  if (info.url && !reviewedUrl(info.url)) {
    const reviews = await readReviews();
    if (!reviews[tabId]) return;
    delete reviews[tabId];
    await writeReviews(reviews);
    allowFraming(tabId, false);
  }
});
