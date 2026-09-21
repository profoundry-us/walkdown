/* walkdown embed — injected into prototypes and dev/staging builds.
 * Framed (inside the viewer): talks postMessage to the parent, which owns
 * screen context and persists pins. Standalone: posts straight to the local
 * walkdown server (its own origin), which resolves the screen from the URL.
 * Never ships to production. */
/*
 * These used to be pasted in between markers by tools/sync-shared.mjs,
 * because a hand-written single file cannot import. The embed is built now
 * (rollup.embed.mjs -> lib/viewer/embed.js), so it imports the same modules
 * the server runs and the panel bundles - one implementation, and no paster
 * to keep honest.
 */
import { MSG } from '../../lib/message-stream.js';
import { matchScreen, normalizeFragment } from '../../lib/screen-match.js';
import { CHIP, TERMINAL } from '../../lib/vocab.js';
import { icon } from './icons.js';

(() => {
  /*
   * Once per page, across BOTH JavaScript worlds. A page can carry walkdown by
   * script tag while the extension injects it too, and those run in separate
   * globals — so a window flag cannot see the other copy and you get two of
   * everything. The DOM is the one thing the two worlds share. The script tag
   * wins when both are present: it runs at parse time, and an app that
   * declares its own blueprint should keep it.
   */
  if (document.documentElement.dataset.walkdownEmbed) return;
  document.documentElement.dataset.walkdownEmbed = '1';
  window.__walkdown = true;

  /*
   * Config arrives one of two ways. Served by `walkdown serve`, this file is a
   * <script> tag: the server substitutes the anchor attribute on its way out,
   * and the tag's src and data-bp say the rest. Loaded by the browser
   * extension there is no tag at all, so the bootstrap leaves the same answers
   * on window.__walkdownConfig first. One implementation, two deliveries —
   * forking it would guarantee the two drift.
   */
  const cfg = window.__walkdownConfig ?? {};
  const SUBSTITUTED = '__ANCHOR_ATTR__';
  const ANCHOR_ATTR =
    cfg.anchorAttribute ?? (SUBSTITUTED.startsWith('__ANCHOR') ? 'data-testid' : SUBSTITUTED);
  const SERVER =
    cfg.server ?? new URL(document.currentScript?.src ?? 'http://localhost:4700').origin;
  // The extension ships the stylesheet itself; served, it comes off the server.
  const STYLESHEET = cfg.stylesheet ?? SERVER + '/walkdown.css';
  const framed = window.parent !== window;

  /*
   * Which blueprint this page belongs to. One server can host sibling projects,
   * so without this a pin dropped on an example app files against whichever
   * blueprint `walkdown serve` happened to start in — silently, and into the
   * wrong project's threads/.
   *
   * Prefer this tag's own data-bp; fall back to any other walkdown tag on the
   * page that declares one (the panel usually does), so a page that already
   * says which project it is does not have to say it twice. The fallback is
   * read lazily: sibling script tags below this one are not parsed yet while
   * this script runs.
   */
  const ownBp = cfg.bp || document.currentScript?.dataset.bp || '';
  /*
   * Framed, the panel says which blueprint is open and that is the answer: a
   * pin files against what the reviewer has open, never against whatever the
   * server would guess from the address (ADR 0001 §12), and never against
   * what a tag on the page says. The tag used to win here, "because a page
   * that says which project it is has said so deliberately" - but pins never
   * came through here framed (they go to the panel, which files with what it
   * has open), so a page carrying a tag had its pin in one blueprint and its
   * reply in another, where the thread did not exist (n-0274). One answer,
   * the panel's; the tag is what is left when there is no panel to ask.
   */
  const blueprintId = () =>
    ctx.bp ||
    ownBp ||
    document.querySelector('script[src*="4700"][data-bp], script[data-walkdown][data-bp]')?.dataset
      .bp ||
    '';
  /*
   * The blueprint rides along as a query parameter — and it has to go BEFORE
   * any fragment, or the fragment swallows it: "#invite-batch?bp=..." is one
   * fragment named that, not a query.
   */
  const api = (path) => {
    const bp = blueprintId();
    const h = path.indexOf('#');
    const head = h < 0 ? path : path.slice(0, h);
    const frag = h < 0 ? '' : path.slice(h);
    const q = bp ? (head.includes('?') ? '&' : '?') + 'bp=' + encodeURIComponent(bp) : '';
    return SERVER + head + q + frag;
  };

  /* walkdown's own chrome, in this page and in the panel docked beside it.
     Pin mode must never treat a click on it as a place to put a pin. Both live
     in shadow roots now, and a click inside one retargets to its host, so the
     single marker covers everything either of them draws. */
  const CHROME = '[data-walkdown-chrome]';

  let ctx = { screen: null, surface: null, pinMode: false, pins: [], viewport: null, bp: null };

  // The surface's own viewport — what the document was laid out at, regardless
  // of how the viewer scaled it into a pane.
  const currentViewport = () =>
    ctx.viewport ?? {
      name: window.innerWidth < 768 ? 'mobile' : 'desktop',
      width: window.innerWidth,
    };
  let overlay = null;
  /** The pin drawn at the spot while its form is open, and gone with it. */
  let placeholder = null;
  // Whose machine this is - the whole identity, username and full name both,
  // so a handle recorded in a thread can be shown as the name that person goes
  // by, whichever of their handles the record happens to carry.
  let identity = null;
  // The rule ids this blueprint knows, so a rule named in a message can be
  // told from prose (MSG.linkRefs). Filled with the blueprint.
  let ruleIds = [];
  // The key of the blueprint the server answered with, for a link out from a
  // page that never said which one it belongs to.
  let blueprintKey = '';
  // What the ids in a message name, for the card under the cursor (n-0298):
  // every rule and every thread the server answered with, not only the pins
  // on this screen, because a message here can name any of them.
  let blueprintRows = [];
  let blueprintThreads = [];

  const $anchors = () => [...document.querySelectorAll(`[${ANCHOR_ATTR}]`)];
  const anchorId = (el) => el.getAttribute(ANCHOR_ATTR);

  // --- the layer walkdown draws in --------------------------------------------
  /*
   * Everything walkdown puts on the page lives in a shadow root, for the same
   * reason the panel's chrome does: this script runs inside somebody else's
   * application, and loading our stylesheet into their document would restyle
   * their buttons and headings through Tailwind's preflight. Inside a shadow
   * root the theme is ours and reaches nothing else — which is what lets the
   * pin form wear the same blueprint skin as the panel rather than a
   * hand-rolled lookalike that drifts from it.
   *
   * The host is positioned at the document's origin and has no size, so a
   * pin's absolute coordinates mean exactly what they meant when pins were
   * children of <body>.
   */
  const layer = document.createElement('div');
  layer.dataset.walkdownChrome = '';
  layer.style.cssText = 'position:absolute; top:0; left:0; width:0; height:0; pointer-events:none;';
  const lr = layer.attachShadow({ mode: 'open' });
  /*
   * The theme carrier. daisyUI paints a background on every [data-theme]
   * element, so it must never be something with size — this one is 0x0 and
   * paints nothing, while the custom properties it defines inherit down to the
   * chrome that actually has surfaces.
   */
  const root = document.createElement('div');
  root.dataset.theme = 'blueprint';
  // Undressed until the fetched stylesheet lands — see the rule that reads it.
  root.className = 'wd-unstyled';
  // Inheritance is the one thing a shadow root does not keep out, so what the
  // host page sets on our layer stops here - see the same reset in panel.js.
  root.style.cssText =
    'position:absolute; top:0; left:0; width:0; height:0; letter-spacing:normal; word-spacing:normal; text-transform:none; font-variant:normal; font-style:normal; text-indent:0; text-shadow:none; white-space:normal; word-break:normal; text-align:left; direction:ltr; text-decoration:none;';
  lr.appendChild(root);
  // The preview under a reference, shared with the panel: what an id names,
  // before you follow it out of here (n-0298).
  MSG.hoverCards(root, {
    rows: () => blueprintRows,
    threads: () => blueprintThreads,
    names: () => MSG.nameMap(identity),
  });
  (document.body ?? document.documentElement).appendChild(layer);

  /*
   * The stylesheet goes into the shadow root, where it styles us alone. Its
   * @property rules are ALSO copied into the host document, because the CSS
   * Properties API only registers @property at document level — unregistered,
   * Tailwind's --tw-border-style and friends have no initial value and borders
   * and rings silently stop working. That copy declares types and paints
   * nothing, so it is the one thing we add to the host page. The panel adds
   * the same copy, so whichever loads first wins and the other stands down.
   */
  fetch(STYLESHEET)
    .then((r) => r.text())
    .then((css) => {
      const sheet = document.createElement('style');
      // The conversation's own rules ride along: one shared block, so a thread
      // looks the same here as it does in the panel.
      sheet.textContent = css + MSG.css;
      lr.insertBefore(sheet, root);
      // Dressed now, so what is drawn may be shown. Only on success: with no
      // stylesheet at all, pinning still works (see the catch below) and a
      // page of tooltips unfurled into the layout is not the fallback anyone
      // wants.
      root.classList.remove('wd-unstyled');
      if (document.querySelector('[data-walkdown-property-registrations]')) return;
      const props = css.match(/@property\s+--[\w-]+\s*\{[^}]*\}/g);
      if (!props) return;
      const doc = document.createElement('style');
      doc.setAttribute('data-walkdown-property-registrations', '');
      doc.textContent = props.join('');
      document.head.appendChild(doc);
    })
    .catch(() => {
      /* unstyled beats absent; pinning still works */
    });

  /*
   * The only rules that must live in the host document, because they style the
   * host's own elements rather than ours: what a pinnable thing looks like
   * under the cursor. Everything with a surface of its own is in the shadow.
   */
  const style = document.createElement('style');
  style.textContent = `
    .wd-hover { outline: 2px solid #4bb8dd !important; outline-offset: 2px; cursor: crosshair !important; }
    /* The crosshair means "this is pinnable". walkdown's own chrome is UI, so
       it keeps normal cursors — and, more importantly, stays clickable. */
    .wd-pinning, .wd-pinning * { cursor: crosshair !important; }
    .wd-pinning [data-walkdown-chrome] { cursor: auto !important; }`;
  // The pin's own vocabulary, inside the shadow root where the chrome lives.
  const pinStyle = document.createElement('style');
  pinStyle.textContent = `
    .wd-dot { line-height: 0; }
    /* A white disc in the pin's head carrying the kind - the classic map
       marker, and the one place a letter is legible at this size. */
    .wd-dot .wd-kind {
      position: absolute; top: 3px; left: 50%; transform: translateX(-50%);
      width: 11px; height: 11px; border-radius: 50%; background: #fff; color: currentColor;
      font: 700 8px/11px ui-sans-serif, system-ui, sans-serif; text-align: center;
      pointer-events: none;
    }
    /* Where the pin will land, while the form is open: the same pin, quieter,
       so the spot is never in doubt while you are writing about it. */
    /* The tooltip is for reading, never for clicking: it hovers over the page
       around its pin, and a click meant for the pin must reach the pin. */
    .wd-pin .tooltip-content { pointer-events: none; }
    /* Nothing walkdown draws is shown before the sheet that dresses it has
       landed. This stylesheet is in the shadow root synchronously; the big one
       is FETCHED, and until it arrives a tooltip is simply a visible box of
       text - so every pin on the page showed its tooltip unprompted and then
       transitioned it away as the sheet applied, a fade-out nobody asked for on
       every load (n-0106). Hidden rather than transparent on purpose: opacity
       here would be unlayered CSS and would beat daisyUI's own hover rule,
       which lives in a cascade layer and loses to anything outside one however
       specific it is - a tooltip that never shows at all. */
    .wd-unstyled .tooltip-content { display: none; }
    .wd-ghost-pin { opacity: .55; animation: wd-bob 1.4s ease-in-out infinite; }
    @keyframes wd-bob { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-3px); } }`;
  document.head.appendChild(style);
  // The pin's styles belong to the shadow root: they dress our own markup, and
  // the host page must not inherit a single rule of it.
  lr.appendChild(pinStyle);

  /* One surface for both popovers: the panel's card, at the size of a note. */
  const FORM = `wd-form pointer-events-auto absolute z-[99999] w-64 rounded-box border
    border-primary/45 bg-base-100 p-3 text-[13px] text-base-content shadow-xl`;

  // --- pins -------------------------------------------------------------------
  /*
   * Which way a tooltip should open. It has to be visible, so it opens away
   * from whichever edge the pin is near: down when the pin is near the top,
   * up when it is near the bottom, and otherwise towards the side with the
   * room. Written as whole class names - a `tooltip-${dir}` the stylesheet
   * has never seen is a class that does not exist.
   */
  const TIP_SIDE = {
    top: 'tooltip-top',
    bottom: 'tooltip-bottom',
    left: 'tooltip-left',
    right: 'tooltip-right',
  };
  function tipSide(left, top) {
    const x = left - window.scrollX,
      y = top - window.scrollY;
    const W = window.innerWidth,
      H = window.innerHeight;
    // A tooltip is centred on its pin along the other axis, so a side is only
    // usable when there is room for the card AND for half of it either way.
    const room = { right: W - x, left: x, bottom: H - y, top: y };
    const vRoom = y > 60 && H - y > 60; // left/right are centred vertically
    const hRoom = x > 150 && W - x > 150; // top/bottom are centred horizontally
    if (vRoom && room.right > 300) return TIP_SIDE.right;
    if (vRoom && room.left > 300) return TIP_SIDE.left;
    if (hRoom && room.bottom > 130) return TIP_SIDE.bottom;
    if (hRoom && room.top > 130) return TIP_SIDE.top;
    // Cornered: no side has room to centre the card on the pin. A side
    // tooltip here hangs half its height past the nearer edge (a pin 44px
    // above the bottom drew its 98px card from its own top and the frame cut
    // the last line, n-0326). So go up or down, whichever has more, and
    // align the card's near end to the pin so it grows towards the side
    // with the room instead of straddling the pin.
    const upDown = room.top >= room.bottom ? TIP_SIDE.top : TIP_SIDE.bottom;
    const along = room.right >= room.left ? 'tooltip-start' : 'tooltip-end';
    return `${upDown} ${along} [--tt-trans:0]`;
  }

  function renderPins() {
    root.querySelectorAll('.wd-pin').forEach((p) => p.remove());
    for (const pin of ctx.pins) {
      /*
       * A pin belongs to the surface it was placed on, anchored or not. The
       * prototype and the app carry the same anchor ids, so an anchored pin
       * used to draw on both - a note about the design's tab bar showing up
       * on the app's (n-0255). The surface is what the reviewer was looking
       * at, and the anchor only says where on it. Pins from before the
       * surface was recorded carry none and still draw wherever they match.
       */
      if (pin.surface && ctx.surface && pin.surface !== ctx.surface) continue;
      const el =
        pin.element && document.querySelector(`[${ANCHOR_ATTR}="${CSS.escape(pin.element)}"]`);
      /*
       * Where a pin sits. The spot it was placed at is the truth - it is where
       * the person was pointing - and the anchor is what keeps that spot
       * meaningful when the element moves: the offset within the element is
       * replayed against wherever the element is now. Without an offset (pins
       * placed before this was recorded) an anchored pin still rides the
       * element's corner, and an unanchored one keeps its absolute spot.
       */
      let left, top;
      // A pin's tip is the spot, so the icon hangs above and centred on it -
      // the same way a pin on a map points at the place rather than sitting
      // beside it.
      let spotX, spotY;
      if (el && pin.offset) {
        const rect = el.getBoundingClientRect();
        spotX = window.scrollX + rect.left + pin.offset.x;
        spotY = window.scrollY + rect.top + pin.offset.y;
      } else if (el) {
        const rect = el.getBoundingClientRect();
        spotX = window.scrollX + rect.right - 3;
        spotY = window.scrollY + rect.top + 12;
      } else if (pin.position) {
        spotX = pin.position.x;
        spotY = pin.position.y;
      } else continue;
      left = spotX - 11;
      top = spotY - 19;
      /*
       * The tooltip is ours, not the browser's: a title attribute waits a
       * second or so before it shows, which is a second per pin spent hovering
       * and hoping. This one is markup, so it is there on contact.
       */
      const wrap = document.createElement('div');
      wrap.className = `wd-pin pointer-events-auto absolute z-[99998] ${tipSide(left, top)} tooltip`;
      wrap.dataset.testid = 'pin.marker';
      wrap.dataset.thread = pin.id;
      wrap.style.left = `${left}px`;
      wrap.style.top = `${top}px`;
      const tip = document.createElement('div');
      tip.dataset.testid = 'pin.tip';
      tip.className = 'tooltip-content max-w-70 whitespace-normal text-left';
      tip.innerHTML = pinTip(pin);
      const dot = document.createElement('div');
      // A map pin, because that is what it is. Colour carries the state -
      // amber while the conversation is open, green once it has settled - and
      // the letter in the head says note or question.
      const settled = pin.status !== 'open';
      dot.className = `wd-dot pointer-events-auto relative cursor-pointer
        ${settled ? 'text-success' : 'text-warning'}`;
      dot.innerHTML = `${icon('map-pin-fill', 'size-[22px] drop-shadow')}
        <span class="wd-kind">${pin.kind === 'question' ? '?' : '!'}</span>`;
      dot.onclick = (e) => {
        e.stopPropagation();
        if (framed) window.parent.postMessage({ type: 'walkdown:open-thread', id: pin.id }, '*');
        else openThreadPopover(pin, wrap);
      };
      wrap.append(tip, dot);
      root.appendChild(wrap);
    }
  }

  /*
   * What a pin says under the cursor: which thread, what state it is in, what
   * it is about, and enough of the text to recognise it. Three short lines -
   * a tooltip that has to be read is a tooltip nobody reads.
   */
  function pinTip(pin) {
    const esc = (v) =>
      String(v ?? '').replace(
        /[&<>"]/g,
        (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c],
      );
    const where = [pin.rule ? `rule ${pin.rule}` : 'no rule', pin.screen, pin.element]
      .filter(Boolean)
      .join(' · ');
    const text = String(pin.body ?? '')
      .replace(/\s+/g, ' ')
      .trim();
    return `<div class="font-semibold">${esc(pin.id)} · ${esc(pin.kind)} · ${esc(pin.status)}</div>
      <div class="opacity-70">${esc(where)}</div>${
        text
          ? `<div class="mt-0.5">“${esc(text.length > 90 ? text.slice(0, 89) + '…' : text)}”</div>`
          : ''
      }`;
  }

  // --- standalone thread popover: read + reply (lifecycle actions live in the
  // viewer and CLI, where transitions are validated with an actor) -------------

  /**
   * The thread as a conversation, beside its pin. Same stream, same grouping
   * and the same standing composer as the panel - one tool, one way a thread
   * looks. Replies land on screen before the server answers; a refused one
   * says so and keeps the text.
   */
  function openThreadPopover(pin, dot, pending = []) {
    overlay?.remove();
    overlay = document.createElement('div');
    overlay.className = FORM;
    overlay.dataset.testid = 'thread.panel';
    // Beside the pin, and on the page: a pin in the right-hand column used
    // to open its conversation past the viewport's edge (seen re-judging
    // one-stream, 2026-09-14). Same clamp as the pin form below.
    overlay.style.left = `${Math.max(
      window.scrollX + 8,
      Math.min(parseFloat(dot.style.left), window.scrollX + window.innerWidth - 268),
    )}px`;
    overlay.style.top = `${parseFloat(dot.style.top) + 24}px`;
    overlay.innerHTML = `
      <div class="flex items-center gap-1.5">
        <b class="font-mono text-[11.5px]">${pin.id}</b>
        <span class="badge badge-xs ${CHIP[pin.status] ?? 'badge-ghost'}">${pin.status}</span>
        <span class="text-[11px] opacity-40">${pin.kind}</span>
        <button class="btn btn-xs btn-ghost wd-cancel ml-auto">✕</button>
      </div>
      <div class="wd-stream mt-1 max-h-64 overflow-y-auto">${MSG.stream(pin, {
        pending,
        names: MSG.nameMap(identity),
        rules: ruleIds,
      })}</div>
      <textarea class="textarea textarea-sm mt-2 h-14 w-full" placeholder="Reply…"></textarea>
      <div class="mt-1 flex items-center gap-2">
        <span class="text-[10px] opacity-40"><b>Enter</b> sends</span>
        ${
          canVerify(pin)
            ? `<button class="btn btn-xs btn-outline btn-success wd-verify ml-auto" data-testid="thread.verify"
                 title="Verify ${pin.id} under your name, ${identity.username}">✓ Verify</button>
               <button class="btn btn-xs btn-primary wd-primary">Reply</button>`
            : `<button class="btn btn-xs btn-primary wd-primary ml-auto">Reply</button>`
        }
      </div>
      <div class="wd-say mt-1 hidden text-[11px] text-warning" data-testid="thread.say"></div>`;
    root.appendChild(overlay);
    /*
     * The ids in a message are links only where this popover can open what
     * they name (n-0294). It has no rule screen and no thread screen of its
     * own - those are the panel's - so here a thread id opens that thread
     * when it is a pin on this page, an evidence key opens the file the
     * server resolves it to, and anything else goes back to being the words
     * the author typed. A link that does nothing is worse than none.
     */
    for (const ref of overlay.querySelectorAll('[data-thread-ref], [data-rule-ref], [data-evidence-ref]')) {
      if (ref.dataset.evidenceRef) {
        ref.href = api('/evidence/' + ref.dataset.evidenceRef);
        ref.target = '_blank';
        ref.rel = 'noopener noreferrer';
        continue;
      }
      const other = ref.dataset.threadRef && ctx.pins.find((p) => p.id === ref.dataset.threadRef);
      const wrap = other && root.querySelector(`.wd-pin[data-thread="${CSS.escape(other.id)}"]`);
      if (other && wrap) {
        ref.onclick = (e) => {
          e.preventDefault();
          e.stopPropagation();
          openThreadPopover(other, wrap);
        };
        continue;
      }
      /*
       * A rule, or a thread not pinned on this page: this popover has no
       * screen for either, but the panel does, at an address of its own -
       * walkdown's page with `?rule=` or `?thread=` - so the id links out
       * to it, in a new tab, the way the evidence key does (n-0297). It
       * was plain words before that address existed; now it names the
       * thing and opens it.
       */
      const out = new URL(api('/'));
      // Named by key even where this page never said which blueprint: the
      // answer the server gave says which one it was.
      if (!out.searchParams.get('bp') && blueprintKey) out.searchParams.set('bp', blueprintKey);
      if (ref.dataset.ruleRef) out.searchParams.set('rule', ref.dataset.ruleRef);
      else out.searchParams.set('thread', ref.dataset.threadRef);
      const a = document.createElement('a');
      a.className = ref.className;
      a.textContent = ref.textContent;
      a.href = out.href;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      if (ref.dataset.ruleRef) a.dataset.ruleRef = ref.dataset.ruleRef;
      else a.dataset.threadRef = ref.dataset.threadRef;
      // No title: the card under the cursor says what it is and that it
      // leaves the page (n-0298), and a browser tooltip on top would fight it.
      ref.replaceWith(a);
    }
    // Open at the newest message, the way you left a conversation - reading a
    // thread from its top means scrolling past what you already know.
    const stream = overlay.querySelector('.wd-stream');
    if (stream) stream.scrollTop = stream.scrollHeight;
    const box = overlay.querySelector('textarea');
    overlay.querySelector('.wd-cancel').onclick = () => closeForm();
    const send = () => {
      const body = box.value.trim();
      if (!body) return;
      // On screen first: waiting on a round trip to see your own words is what
      // makes a thread feel like a form.
      const msg = { author: 'you', created: new Date().toISOString(), body, pending: true };
      openThreadPopover(pin, dot, [...pending, msg]);
      fetch(api(`/api/threads/${pin.id}/replies`), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ body }),
      })
        .then((r) => r.json())
        .then((data) => {
          if (data.thread) {
            Object.assign(pin, { replies: data.thread.replies });
            openThreadPopover(pin, dot);
          } else throw new Error(data.error ?? 'refused');
        })
        .catch(() => {
          console.warn('walkdown: reply not recorded');
          openThreadPopover(pin, dot, [...pending, { ...msg, pending: false, failed: true }]);
          overlay.querySelector('textarea').value = body;
        });
    };
    overlay.querySelector('.wd-primary').onclick = send;
    /*
     * Verify, beside the pin (ADR 0005 §7). The pin is where you are already
     * looking at the thing the thread is about, so the acceptance is offered
     * here - under the same law as everywhere: only a person the config
     * declares, only on a thread waiting for one, and the server validates
     * the transition exactly as it does for the panel. Waive stays off this
     * row: it needs a reason, and this reply box carries no instructions.
     */
    const verify = overlay.querySelector('.wd-verify');
    if (verify)
      verify.onclick = () => {
        verify.disabled = true;
        fetch(api(`/api/threads/${pin.id}/status`), {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ status: 'verified' }),
        })
          .then((r) => r.json())
          .then((data) => {
            if (!data.thread) throw new Error(data.error ?? 'refused');
            Object.assign(pin, { status: data.thread.status, replies: data.thread.replies });
            // A verified pin leaves the page - it is settled - the way every
            // other terminal thread does on the next render.
            ctx.pins = ctx.pins.filter((p) => p.id !== pin.id);
            closeForm();
            renderPins();
          })
          .catch((err) => {
            verify.disabled = false;
            const say = overlay?.querySelector('.wd-say');
            if (say) {
              say.textContent = String(err?.message ?? 'not verified');
              say.classList.remove('hidden');
            }
          });
      };
    box.onkeydown = (e) => {
      if (e.key !== 'Enter' || e.shiftKey || e.isComposing) return;
      e.preventDefault();
      send();
    };
    box.focus();
  }

  /*
   * Whether this popover may offer Verify on this pin: a declared person -
   * never a guess, never a machine - and a note at `addressed` whose reason a
   * person closes. A finding is offered too, for the person who wants to
   * close it before the rule's next pass would; an observation is the
   * agent's to settle and a question is answered, not verified.
   */
  function canVerify(pin) {
    if (!identity?.declared || !identity?.username || String(identity.username).trim().toLowerCase() === 'agent')
      return false;
    if (pin.kind !== 'note' || pin.status !== 'addressed') return false;
    return ['feedback', 'request', 'finding'].includes(pin.reason ?? 'feedback');
  }

  // --- pin creation -----------------------------------------------------------
  // Opens for an anchored element, or — when nothing anchored was under the
  // click — at the click point itself, pinning by position.
  function openForm(el, point) {
    overlay?.remove();
    /*
     * The form opens at the spot, not at the element's foot: what you are
     * writing about is the point you clicked, and a form that jumps to the
     * bottom of a tall element leaves you writing about something you can no
     * longer see. Below the spot when there is room, above it when there is
     * not, and never off the side.
     */
    overlay = document.createElement('div');
    overlay.className = FORM;
    overlay.dataset.testid = 'pin.form';
    overlay.style.left = `${Math.max(
      window.scrollX + 8,
      Math.min(point.x - 24, window.scrollX + window.innerWidth - 268),
    )}px`;
    overlay.style.top = `${point.y + 18}px`;
    // The pin that is about to exist, drawn where it will land.
    placeholder?.remove();
    placeholder = document.createElement('div');
    placeholder.className = `wd-ghost-pin wd-dot pointer-events-none absolute z-[99997] text-warning`;
    placeholder.dataset.testid = 'pin.placeholder';
    placeholder.style.left = `${point.x - 11}px`;
    placeholder.style.top = `${point.y - 19}px`;
    placeholder.innerHTML = `${icon('map-pin-fill', 'size-[22px] drop-shadow')}
      <span class="wd-kind">!</span>`;
    root.appendChild(placeholder);
    overlay.innerHTML = `
      <b class="font-mono text-[11.5px]">${el ? anchorId(el) : 'unanchored spot'}</b>
      ${el ? '' : '<div class="text-[11px] opacity-50">no anchored element here — pinned by position</div>'}
      <textarea data-testid="pin.note" class="textarea textarea-sm mt-2 h-16 w-full" placeholder="What should change here?"></textarea>
      <label class="mt-1 flex items-center gap-2 text-[12px]">
        <input type="checkbox" data-testid="pin.kind" class="checkbox checkbox-xs wd-q"> question (not a note)</label>
      <div class="mt-2 flex gap-2">
        <button data-testid="pin.save" class="btn btn-xs btn-primary wd-primary">Pin it</button>
        <button data-testid="pin.cancel" class="btn btn-xs btn-ghost wd-cancel">Cancel</button>
      </div>`;
    root.appendChild(overlay);
    // Measured, then placed: how tall the form is depends on what it says.
    const h = overlay.getBoundingClientRect().height;
    if (point.y - window.scrollY + 18 + h > window.innerHeight)
      overlay.style.top = `${Math.max(window.scrollY + 8, point.y - h - 18)}px`;
    // The kind switch moves the placeholder's letter with it, so the pin on the
    // page always says what is about to be filed.
    const kindBox = overlay.querySelector('.wd-q');
    kindBox.onchange = () => {
      const mark = placeholder?.querySelector('.wd-kind');
      if (mark) mark.textContent = kindBox.checked ? '?' : '!';
    };
    overlay.querySelector('textarea').focus();
    overlay.querySelector('.wd-cancel').onclick = () => closeForm();
    overlay.querySelector('.wd-primary').onclick = () => {
      const body = overlay.querySelector('textarea').value.trim();
      const kind = overlay.querySelector('.wd-q').checked ? 'question' : 'note';
      if (!body) return;
      /*
       * The click point is recorded either way: it is where the person was
       * actually pointing, and an anchored pin that forgets it can only be
       * drawn at a corner of its element. The anchor rides alongside as the
       * durable part - element plus the offset within it, so the same spot
       * survives the element moving.
       */
      const rect = el?.getBoundingClientRect();
      submitPin({
        ...(el && {
          element: anchorId(el),
          offset: {
            x: Math.round(point.x - (window.scrollX + rect.left)),
            y: Math.round(point.y - (window.scrollY + rect.top)),
          },
        }),
        position: point,
        body,
        kind,
        surface: ctx.surface,
        viewport: currentViewport(),
      });
      closeForm();
    };
  }

  /** The form and the pin it was promising go together. */
  function closeForm() {
    overlay?.remove();
    overlay = null;
    placeholder?.remove();
    placeholder = null;
  }

  function submitPin(pin) {
    if (framed) {
      window.parent.postMessage({ type: 'walkdown:new-pin', ...pin }, '*');
    } else {
      fetch(api('/api/threads'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ...pin,
          anchor: {
            ...(pin.element && { element: pin.element }),
            ...(pin.offset && { offset: pin.offset }),
            ...(pin.position && { position: pin.position }),
            ...(pin.surface && { surface: pin.surface }),
            ...(pin.viewport && { viewport: pin.viewport }),
          },
          url: location.href,
        }),
      })
        .then((r) => r.json())
        .then((data) => {
          // Carry back what the server stamped, so a pin opened straight after
          // being dropped reads as a message like any other.
          ctx.pins.push({
            ...pin,
            id: data.id,
            status: 'open',
            author: data.thread?.author,
            via: data.thread?.via ?? null,
            created: data.thread?.created,
          });
          renderPins();
        })
        .catch(() => console.warn('walkdown: server unreachable — start `walkdown serve`'));
    }
  }

  // --- pin mode interaction ---------------------------------------------------
  let hovered = null;
  document.addEventListener('mouseover', (e) => {
    if (!ctx.pinMode) return;
    const el = e.target.closest?.(`[${ANCHOR_ATTR}]`);
    hovered?.classList.remove('wd-hover');
    hovered = el;
    el?.classList.add('wd-hover');
  });
  document.addEventListener(
    'click',
    (e) => {
      if (!ctx.pinMode || overlay?.contains(e.target)) return;
      // walkdown's own chrome is never a pin target: the panel has to be able
      // to turn pin mode back off, a pin has to be able to open its thread, and
      // the docked panel has to keep working while you pin. A click inside the
      // panel's shadow root retargets to its host element, which carries the
      // marker, so one check covers the whole panel.
      if (e.target.closest?.(CHROME)) return;
      const el = e.target.closest?.(`[${ANCHOR_ATTR}]`);
      e.preventDefault();
      e.stopPropagation();
      // No anchored element under the cursor: pin the spot itself.
      openForm(el, { x: window.scrollX + e.clientX, y: window.scrollY + e.clientY });
    },
    true,
  );

  /*
   * A pointer going down on the page, reported outward.
   *
   * The panel's popovers — the screen picker and the desk tuner — close on a
   * click anywhere outside them, and the panel listens for that with a
   * capturing pointerdown on its own document. Framed, this page is a document
   * of its own: a pointerdown here never reaches the parent, so a click in the
   * application under review left them open, which is most of "anywhere
   * outside" (n-0111). So the frame says so out loud, the same way it already
   * reports leaving pin mode. Passive and never cancelled — this only tells,
   * it does not take the gesture from the application.
   */
  if (framed)
    document.addEventListener(
      'pointerdown',
      () => window.parent.postMessage({ type: 'walkdown:page-click' }, '*'),
      { capture: true, passive: true },
    );

  // Escape is the way out of any mode: it closes the open form first, then
  // leaves pin mode. Without it the only exit was the bar's control, which
  // itself was swallowing.
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !ctx.pinMode) return;
    if (overlay) {
      closeForm();
      return;
    }
    setPinMode(false);
    if (framed) window.parent.postMessage({ type: 'walkdown:pin-mode', on: false }, '*');
  });

  const pinWatchers = new Set();
  function setPinMode(on) {
    ctx.pinMode = on;
    // Anywhere is pinnable, so the whole surface reads as targetable.
    document.documentElement.classList.toggle('wd-pinning', on);
    if (!on) {
      hovered?.classList.remove('wd-hover');
      overlay?.remove();
      overlay = null;
    }
    for (const fn of pinWatchers) fn(on);
  }

  /*
   * The one seam other walkdown chrome may use. The panel puts a pin-mode
   * control in its header, and pin mode has exactly one owner - this script -
   * so the panel asks rather than keeping a second copy of the state that
   * Escape would then have to remember to update.
   */
  window.walkdownEmbed = {
    isPinMode: () => ctx.pinMode,
    setPinMode,
    watchPinMode(fn) {
      pinWatchers.add(fn);
      return () => pinWatchers.delete(fn);
    },
  };

  /*
   * Screen identity, shared verbatim with the panel and the server so a pin
   * cannot land on one screen here and a different one there.
   */

  /*
   * The URL can change without the page reloading, and a modal, a drawer or an
   * SPA route is its own screen (docs/06 §2). hashchange and popstate cover
   * two of the three ways that happens; history.pushState announces nothing,
   * and in the extension's isolated world the page's History object is not
   * ours to patch — so a slow poll catches the rest instead of pretending.
   */
  let hereUrl = location.pathname + normalizeFragment(location.hash);
  function watchLocation(onChange) {
    const check = () => {
      const now = location.pathname + normalizeFragment(location.hash);
      if (now === hereUrl) return;
      hereUrl = now;
      onChange();
    };
    window.addEventListener('hashchange', check);
    window.addEventListener('popstate', check);
    setInterval(check, 400);
  }

  /*
   * Point at one anchored element, because the panel is talking about it.
   *
   * The same outline pin mode draws under the cursor, on purpose: a reviewer
   * has already learnt what that ring means, and a second highlight vocabulary
   * would be one more thing to learn for the same fact. `null` puts it back.
   */
  let highlighted = null;
  function setHighlight(id) {
    highlighted?.classList.remove('wd-hover');
    highlighted = id ? document.querySelector(`[${ANCHOR_ATTR}="${CSS.escape(id)}"]`) : null;
    highlighted?.classList.add('wd-hover');
  }

  // --- framed mode: context from the viewer -----------------------------------
  window.addEventListener('message', (e) => {
    const msg = e.data;
    if (!msg || typeof msg !== 'object') return;
    // A step in the panel naming an anchor: show which element it means.
    if (msg.type === 'walkdown:highlight') return setHighlight(msg.element ?? null);
    if (msg.type === 'walkdown:context') {
      ctx = {
        ...ctx,
        screen: msg.screen ?? ctx.screen,
        surface: msg.surface ?? ctx.surface,
        bp: msg.bp ?? ctx.bp,
        viewport: msg.viewport ?? ctx.viewport,
        pins: msg.pins ?? [],
      };
      if (typeof msg.pinMode === 'boolean') setPinMode(msg.pinMode);
      renderPins();
    }
  });

  /*
   * Two contexts, and pin mode has an owner in both. Framed, the embed reports
   * what it is looking at and the panel outside drives it. Top level, the panel
   * is in this same document and owns the control outright.
   *
   * There was a third: an embed with no panel anywhere carried a floating badge
   * of its own. It went when the only page that could reach it turned out to be
   * one nobody opens (n-0058) - and it had been leaking onto panelled pages
   * besides, which is two controls for a thing that must have exactly one.
   */
  if (framed) {
    const announce = () =>
      window.parent.postMessage(
        { type: 'walkdown:ready', anchors: $anchors().map(anchorId), href: location.href },
        '*',
      );
    announce();
    // Again once the document is parsed, so the anchor list is the whole one
    // rather than however much had been seen when this script ran.
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', announce);
    /*
     * The panel cannot read this frame's URL across origins, so a navigation
     * inside the application is only visible to it if the application says so.
     * Same three ways a URL changes, same slow poll for the one that announces
     * nothing.
     */
    watchLocation(announce);
  } else {
    // After the document is parsed: the pins need the anchored elements to
    // position against, and blueprintId() needs to be able to see a sibling
    // walkdown tag further down the page.
    /*
     * The blueprint is fetched once and kept, because the answer it feeds —
     * which screen is this? — has to be recomputed every time the URL changes,
     * and re-fetching a blueprint on every drawer open would be absurd.
     */
    let blueprint = null;
    const resolve = () => {
      if (!blueprint) return;
      const hit = matchScreen(blueprint.storyboard ?? [], location);
      // Off the storyboard: drop the old screen rather than keep stamping pins
      // with the last screen that did match, which would file them against a
      // page nobody is looking at.
      ctx.screen = hit?.screen?.id ?? null;
      ctx.surface = hit?.surface ?? null;
      ctx.pins = !hit
        ? []
        : blueprint.threads
            .filter((t) => t.anchor?.screen === hit.screen.id && !TERMINAL.includes(t.status))
            .map((t) => ({
              id: t.id,
              kind: t.kind,
              status: t.status,
              reason: t.reason ?? null,
              element: t.anchor?.element,
              position: t.anchor?.position,
              surface: t.anchor?.surface,
              viewport: t.anchor?.viewport,
              // Who wrote the note and when: the opening message is a message, and a
              // message without an author reads as nobody having said it.
              offset: t.anchor?.offset,
              rule: t.anchor?.rule ?? null,
              screen: t.anchor?.screen ?? null,
              author: t.author,
              // How the opening message arrived rides with its author: a note an
              // agent typed under a person's name must not read as the person's
              // own words while the reply under it says `via agent` (n-0152).
              via: t.via ?? null,
              created: t.created,
              body: t.body,
              replies: t.replies ?? [],
            }));
      renderPins();
    };
    const start = () =>
      fetch(api('/api/blueprint'))
        .then((r) => r.json())
        .then((data) => {
          blueprint = data;
          identity = data.identity ?? null;
          ruleIds = (data.rows ?? []).map((r) => r.rule);
          blueprintKey = data.key ?? '';
          blueprintRows = data.rows ?? [];
          blueprintThreads = data.threads ?? [];
          MSG.zone = identity?.timezone ?? null;
          resolve();
        })
        .catch(() => {}); // server not running — embed stays dormant
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
    else start();
    watchLocation(resolve);
  }

  window.addEventListener('resize', renderPins);
  window.addEventListener('scroll', renderPins, true);
})();
