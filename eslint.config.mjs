/*
 * One rule, for one failure mode.
 *
 * Splitting the panel into modules turns a working reference into a
 * ReferenceError the moment the name it points at moves to another file and
 * the caller stays behind. `node --check` cannot see it — the syntax is
 * perfect — so it survives to runtime, where it takes out whatever code path
 * touches it and nothing else. Twice now it has cost a full browser suite to
 * find something a scope check answers instantly:
 *
 *   host is not defined   (a codemod's skip range was too broad)
 *   veil is not defined   (one caller left behind when the veil moved out)
 *
 * So: no-undef over the panel's source, and nothing else. This is not a style
 * gate and should not grow into one — the repo has no lint culture to
 * enforce, and a rule nobody asked for is a rule people learn to skip.
 */
import globals from 'globals';

export default [
  {
    files: ['src/panel/**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: globals.browser,
    },
    linterOptions: { reportUnusedDisableDirectives: true },
    rules: { 'no-undef': 'error' },
  },
];
