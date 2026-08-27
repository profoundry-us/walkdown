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
};
