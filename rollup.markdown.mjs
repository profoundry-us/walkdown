/*
 * marked and DOMPurify, vendored — the same arrangement vendor/lit.js has and
 * for the same reason (docs/09-delivery.md): the clone is the whole install,
 * so what renders a thread body is committed, not fetched. Tree-shaken like
 * lit: third-party, nothing in it runs at module load for our sake.
 */
import { nodeResolve } from '@rollup/plugin-node-resolve';

export default {
  input: 'src/vendor-entries/markdown.js',
  plugins: [nodeResolve()],
  output: {
    file: 'vendor/markdown.js',
    format: 'es',
    banner: `// @ts-nocheck — third-party code; walkdown type-checks its own source, not marked's or DOMPurify's.
/*
 * marked + DOMPurify — vendored into walkdown, not hand-written. Do not edit.
 * Bundled from the \`marked\` and \`dompurify\` packages by \`npm run build:markdown\`
 * (rollup.markdown.mjs). Update by bumping either in devDependencies and
 * rebuilding; vendor/LICENSE-marked and vendor/LICENSE-dompurify carry the
 * original terms.
 */`,
  },
  onwarn(warning, warn) {
    warn(warning);
    throw new Error(`rollup: ${warning.code}`);
  },
};
