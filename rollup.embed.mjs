/*
 * The embed, bundled — the same arrangement the panel has, for the same
 * reasons (rollup.config.mjs explains both load-bearing settings). This entry
 * existed later than the panel's because the embed stayed a hand-written
 * single file for a month, with shared code PASTED in between markers by
 * tools/sync-shared.mjs; that tool's own comment promised it would retire
 * when the embed got a bundler, and this is the retirement.
 *
 * The output keeps the __ANCHOR_ATTR__ placeholder verbatim: `walkdown
 * serve` substitutes it per blueprint on the way out, and the extension's
 * bootstrap answers it at runtime instead.
 */
export default {
  input: 'src/embed/index.js',
  treeshake: false,
  output: { file: 'lib/viewer/embed.js', format: 'es' },
  onwarn(warning, warn) {
    warn(warning);
    throw new Error(`rollup: ${warning.code}`);
  },
};
