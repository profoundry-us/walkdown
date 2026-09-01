/*
 * Pin the personal home for a test file, so no suite can write into whoever
 * ran it (n-0137).
 *
 * Several suites build fixture blueprints and then serve them, or spawn the
 * CLI at them. Locations resolve from `~/.walkdown/config.yml`, so an
 * unpinned run files their drafts, their evidence and - since the config
 * became the only list - their PROJECT ENTRIES into the developer's own home.
 * Thirteen dead entries accumulated there on 2026-09-01 from three runs.
 *
 * `npm test` and `runner.run_all` pin it, but that guards the callers
 * somebody wrote down. A bare `node --test test/serve.test.js` is a thing
 * people type, and it should not depend on remembering. Importing this is
 * how a suite stops depending on its caller:
 *
 *     import '../tools/test-home.mjs';
 *
 * `??=`, so a caller that pinned deliberately still wins - the runner's
 * `.walkdown/test-home` keeps working, and a suite that pins its own scratch
 * home per case (locations.test.js) is unaffected either way.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.WALKDOWN_HOME ??= mkdtempSync(join(tmpdir(), 'walkdown-test-home-'));
