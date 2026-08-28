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
 *   format: 'es'  — an 'iife' format would wrap the result in a second
 *     function. The panel is already its own IIFE, and the extension imports
 *     the output as a module; 'es' with only internal modules emits neither
 *     an import nor an export, so the same bytes satisfy both deliveries.
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
  output: { file: 'lib/viewer/panel.js', format: 'es' },

  /*
   * A pane triggers behaviour that redraws panes, so app.js and the pane
   * modules import each other. That cycle is expected and safe — nothing
   * crosses it at module evaluation time, only from handlers and renders —
   * and the alternative was threading a bag of callbacks through every wire
   * call. Reporting it on every build would train everyone to ignore the
   * warning that matters.
   *
   * So: cycles inside src/panel pass in silence, and everything else — a
   * cycle reaching the entry, an unresolved import, anything Rollup wants to
   * say — is still an error the build stops on.
   */
  onwarn(warning, warn) {
    const inPanel = (p) => typeof p === 'string' && p.includes('src/panel/')
      && !p.endsWith('src/panel/index.js');
    if (warning.code === 'CIRCULAR_DEPENDENCY' && (warning.ids ?? []).every(inPanel)) return;
    warn(warning);
    throw new Error(`rollup: ${warning.code}`);
  },
};
