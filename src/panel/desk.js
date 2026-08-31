/*
 * How the desk is drawn — the ruled plane the page sheet lies on.
 *
 * Drawing only. What happens WHEN the desk is repainted (reseating the frame,
 * the ghost, the peek and the headless cover) is paintDesk, which stays in
 * index.js because it orchestrates half the panel; this module would have had
 * to import back from it, and a cycle for one function is a bad trade.
 */
import { S } from './state.js';

/*
 * The desk: drafting paper, ruled faintly enough to read as texture rather
 * than as content, and tilted off square because a perfectly upright grid
 * reads as a spreadsheet.
 *
 * repeating-linear-gradient rather than a tiled background-size, because the
 * repetition runs along the gradient's own axis: it seams correctly at any
 * angle, where a 24px tile only lines up with its neighbours at multiples of
 * 90 degrees. The two rulings are one right angle apart, so the grid stays
 * square and only its orientation changes.
 */
/*
 * The desk's look is a preference, not a truth about any blueprint — so the
 * values live in one object, are tunable from the gear in the bar, and
 * persist through the same store as every other panel choice.
 */
export const DESK_KEY = 'walkdown:desk';
export const DESK_DEFAULTS = {
  tilt: 35, // degrees clockwise, spun within the paper's own plane
  tip: 35, // degrees the plane leans away from the viewer
  depth: 600, // the camera's distance; nearer converges harder
  gap: 60, // ruling pitch on the tipped plane
  ink: 10, // line strength, % of the theme's ink
};
// Seeded here rather than with the rest of S, so the defaults stay beside
// the dials that tune them.
S.desk = { ...DESK_DEFAULTS };
const DESK_SKEW = 7; // fallback only: how far the rulings fall short of a right angle
const line = (ink) => `color-mix(in oklch, ${ink} ${S.desk.ink}%, transparent)`;
const ruling = (ink, deg, gap) =>
  `repeating-linear-gradient(${deg}deg, ${line(ink)} 0 1px, transparent 1px ${gap}px)`;

/*
 * The fallback ruling: an affine skew painted straight onto the root. Not
 * quite a right angle, one axis breathing wider — the most a background can
 * do on its own, since gradients repeat at a fixed pitch and parallel stays
 * parallel.
 */
const deskLines = (ink) =>
  `${ruling(ink, S.desk.tilt, S.desk.gap - 8)}, ${ruling(ink, S.desk.tilt + 90 - DESK_SKEW, S.desk.gap - 4)}`;

/*
 * The real thing: a square grid on its own plane, tipped away from the
 * viewer in actual 3D, so the lines converge toward the horizon the way a
 * sheet on a desk does. This was never possible on the root itself — in the
 * docked layout that is the host application's own <html>, and a transform
 * there hands every fixed element in the app a new containing block — but a
 * dedicated layer transforms nothing but itself.
 *
 * The layer sits at z-index -1 as a child of the root: painted above the
 * root's own background, below the body's — so the page sheet still covers
 * it and only the desk margins show it. Oversized because a tipped plane's
 * corners pull inward; the excess keeps its edges out of the viewport.
 */
const HAS_3D =
  typeof CSS !== 'undefined' && CSS.supports?.('transform', 'perspective(1px) rotateX(1deg)');
let deskEl = null;

export function drawDesk(on, ink) {
  const root = document.documentElement;
  if (!on || !HAS_3D) {
    deskEl?.remove();
    deskEl = null;
    if (on) {
      root.style.backgroundImage = deskLines(ink);
      root.style.backgroundAttachment = 'fixed';
    }
    return;
  }
  root.style.backgroundImage = 'none';
  if (!deskEl) {
    deskEl = document.createElement('div');
    deskEl.dataset.testid = 'panel.desk';
    deskEl.dataset.walkdownChrome = '';
    root.appendChild(deskEl);
  }
  deskEl.style.cssText = `position:fixed; left:50%; top:50%; width:320vmax; height:320vmax;
    margin:-160vmax 0 0 -160vmax; z-index:-1; pointer-events:none;
    background-image:${ruling(ink, 0, S.desk.gap)}, ${ruling(ink, 90, S.desk.gap)};
    transform:perspective(${S.desk.depth}px) rotateX(${S.desk.tip}deg) rotate(${S.desk.tilt}deg);`;
}
