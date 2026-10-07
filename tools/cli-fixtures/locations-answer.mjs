// Fixtures for the locations.answer screens: what walkdown says where it has no answer.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

export default {
  /* `shop` a real repository with `checkout` registered, and a separate repository cloned inside it at vendor/lib. */
  'nested-repository'(m, h) {
    h.realRepo(m);
    m.ok(['blueprints', 'new', 'checkout']);
    const lib = join(m.shop, 'vendor', 'lib');
    mkdirSync(lib, { recursive: true });
    h.git(m, lib, 'init', '-q');
  },
};
