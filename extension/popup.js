/*
 * Which project is this site? The script-tag delivery reads that off the page,
 * because the page's author put it there. The extension cannot: it is looking
 * at somebody else's application, which has never heard of walkdown. So a
 * person says so once per origin and the answer is remembered.
 */
const SITES = 'walkdown:sites';
const DEFAULT_SERVER = 'http://localhost:4700';
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

async function currentTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function main() {
  const tab = await currentTab();
  let origin;
  try {
    origin = new URL(tab.url).origin;
  } catch {
    return void ($('body').textContent = 'walkdown cannot run on this page.');
  }
  if (!/^https?:$/.test(new URL(tab.url).protocol))
    return void ($('body').textContent = 'walkdown runs on http and https pages.');
  $('origin').textContent = origin;

  const sites = (await chrome.storage.local.get(SITES))[SITES] ?? {};
  const site = sites[origin] ?? {};
  const server = site.server || DEFAULT_SERVER;

  $('body').innerHTML = `
    <label class="flex cursor-pointer items-center gap-2 py-1">
      <input type="checkbox" id="on" class="toggle toggle-sm toggle-primary" ${site.on ? 'checked' : ''}>
      <span>Walk this site down</span>
    </label>
    <label class="mt-3 block">
      <span class="mb-1 block text-[11px] font-bold uppercase tracking-wider opacity-50">walkdown server</span>
      <input id="server" class="input input-sm w-full" value="${esc(server)}">
    </label>
    <p class="mt-3 text-[11px] leading-relaxed opacity-50">Applies to every page on
      <b>${esc(origin)}</b>. Which blueprint it is gets asked once in the panel itself, where
      there is room to describe them.</p>`;

  const save = async () => {
    const next = { ...sites };
    const on = $('on').checked;
    const at = $('server').value.trim() || DEFAULT_SERVER;
    if (!on) delete next[origin];
    else next[origin] = { ...site, on, server: at.replace(/\/+$/, '') };
    await chrome.storage.local.set({ [SITES]: next });
    await chrome.tabs.reload(tab.id);
    window.close();
  };
  $('on').onchange = save;
  $('server').onchange = () => { if ($('on').checked) save(); };
}

main();
