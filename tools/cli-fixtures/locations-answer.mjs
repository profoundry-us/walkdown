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
  /* `shop` with `checkout` and `search`, `acme_main` with a `search` of its own, and ~/Downloads, which holds no blueprint. */
  'three-blueprints-two-projects'(m) {
    m.ok(['blueprints', 'new', 'checkout']);
    m.ok(['blueprints', 'new', 'search']);
    const other = join(m.root, 'acme_main');
    mkdirSync(join(other, '.git'), { recursive: true });
    const r = m.wd(['blueprints', 'new', 'search'], other);
    if (r.status !== 0)
      throw new Error(
        `fixture: blueprints new search in acme_main exited ${r.status}\n${r.stderr}`,
      );
    mkdirSync(join(m.root, 'Downloads'));
  },
};
