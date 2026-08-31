/*
 * yaml, vendored — so that a clone is the whole install.
 *
 * walkdown has exactly one runtime dependency, and a single dependency is
 * still a package registry on the critical path: the projects that need this
 * tool most are the governed ones, where installing anything is a
 * conversation. Committing the bundle removes that conversation entirely
 * (docs/09-delivery.md).
 *
 * Input is yaml's BROWSER build, not its Node one, and the reason is
 * mechanical rather than aesthetic: the browser build is ESM with relative
 * imports, so Rollup bundles it with no resolver and no commonjs plugin,
 * while the Node build is CJS and would need both. The two differ in exactly
 * two places — `log.js` calls console.warn instead of process.emitWarning,
 * and `!!binary` yields a Uint8Array instead of a Buffer. walkdown parses
 * neither warnings-as-behaviour nor binary tags, so neither reaches us.
 *
 * The output is committed and checked, the same arrangement the panel bundle
 * has: `npm run check:yaml` rebuilds to a scratch path and compares, because
 * rebuilding in place would make the file current and the check could never
 * fail.
 */
export default {
  input: 'node_modules/yaml/browser/dist/index.js',
  output: {
    file: 'vendor/yaml.js',
    format: 'es',
    banner: `// @ts-nocheck — third-party code; walkdown type-checks its own lib/, not yaml's internals.
/*
 * yaml — vendored into walkdown, not hand-written. Do not edit.
 *
 * Bundled from the \`yaml\` package's browser build by \`npm run build:yaml\`
 * (rollup.vendor.mjs, which explains why the browser build). Update it by
 * bumping \`yaml\` in devDependencies and rebuilding; see vendor/LICENSE for
 * the original terms and vendor/README.md for why this file exists.
 */`,
  },
  onwarn(warning, warn) {
    warn(warning);
    throw new Error(`rollup: ${warning.code}`);
  },
};
