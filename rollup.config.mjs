/*
 * The panel ships as one self-contained script down two delivery paths — a
 * classic <script> from `walkdown serve`, and a dynamic import() from the
 * extension's boot-host — so whatever it is split into must come back
 * together before it is delivered. Rollup, because its single-entry output
 * is a plain concatenation of the modules: no runtime shim, no __esModule
 * wrapper, nothing between the source and the thing the browser runs.
 *
 * Two settings are load-bearing:
 *
 *   format: 'iife' — this used to be 'es', on the reasoning that the panel
 *     was already its own IIFE. That was true and still insufficient: as a
 *     CLASSIC script, a bundle's top-level const/let are page-global lexical
 *     bindings shared with every other script on the page, and the panel is
 *     injected into pages it does not own. It survived by luck while its
 *     names were distinctive; bundling lit (whose minified top level is
 *     one-letter names like `s`) made a collision near-certain — the check
 *     fixture's own `const s` was the first to die of it. The wrapper leaks
 *     nothing, and a module import() of an export-less IIFE is still fine,
 *     which is how the extension loads it.
 *
 *   treeshake: false — the panel's top level is nothing but side effects
 *     (it builds a shadow root and hangs listeners off the document). Tree
 *     shaking judges that by heuristics, and a wrong guess deletes chrome.
 *     The bundler's job here is assembly, not optimisation.
 *
 * As of the first shard this config is a no-op by construction: the output
 * is byte-identical to the input, which is what `npm run build:js -- --check`
 * (and the Highball rule that runs it) exists to keep true.
 */
export default {
  input: 'src/panel/index.js',
  treeshake: false,
  output: { file: 'lib/viewer/panel.js', format: 'iife' },

  /*
   * Every warning is fatal, cycles included. The whitelist that used to
   * excuse cycles inside src/panel is gone with the cycles themselves: the
   * panes render templates and fire events, conversation.js talks upward
   * only through shell.js, and nothing imports app.js back. A cycle
   * appearing here again is a design regression, not an inconvenience.
   */
  onwarn(warning, warn) {
    warn(warning);
    throw new Error(`rollup: ${warning.code}`);
  },
};
