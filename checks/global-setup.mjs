/*
 * The checkspace is prepared from playwright.config.js at import, because the
 * web servers launch before this runs (see checks/checkspace.mjs). This hook
 * stays so `globalSetup` keeps naming the file a reader expects, and calling
 * prepare again is a no-op once the config has.
 */
import { prepare } from './checkspace.mjs';
import { EXAMPLE_DECLARED, EXAMPLE_ORIGIN } from '../playwright.config.js';

export { CHECKSPACE } from './checkspace.mjs';

export default function globalSetup() {
  prepare({ exampleDeclared: EXAMPLE_DECLARED, exampleOrigin: EXAMPLE_ORIGIN });
}
