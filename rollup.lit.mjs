/*
 * lit-html, vendored — the same arrangement vendor/yaml.js has and for the
 * same reason (docs/09-delivery.md): the clone is the whole install, so the
 * panel's templating library is committed, not fetched. Unlike the panel
 * builds this one tree-shakes: lit is third-party, nothing in it runs at
 * module load for our sake, and the curated entry names what we use.
 */
import { nodeResolve } from '@rollup/plugin-node-resolve';

export default {
  input: 'src/vendor-entries/lit.js',
  plugins: [nodeResolve()],
  output: {
    file: 'vendor/lit.js',
    format: 'es',
    banner: `// @ts-nocheck — third-party code; walkdown type-checks its own source, not lit's internals.
/*
 * lit-html — vendored into walkdown, not hand-written. Do not edit.
 * Bundled from the \`lit-html\` package by \`npm run build:lit\`
 * (rollup.lit.mjs). Update by bumping lit-html in devDependencies and
 * rebuilding; vendor/LICENSE-lit carries the original terms.
 */`,
  },
  onwarn(warning, warn) {
    // lit's own modules carry no cycles or unresolved imports; anything
    // rollup wants to say about them is worth stopping for.
    warn(warning);
    throw new Error(`rollup: ${warning.code}`);
  },
};
