# vendor

Third-party code, committed rather than installed, so that **cloning walkdown
is the whole install**.

Two files, neither ever edited by hand:

- `yaml.js` — the [`yaml`][yaml] package, bundled by `npm run build:yaml`
  (`rollup.vendor.mjs`, which also explains why it is bundled from yaml's
  browser build rather than its Node one).
- `lit.js` — [`lit-html`][lit], bundled by `npm run build:lit`
  (`rollup.lit.mjs`) from the curated entry `src/vendor-entries/lit.js`, so
  the bundle carries exactly what the panel uses. Terms in `LICENSE-lit`
  (BSD-3-Clause).

## Why

walkdown had exactly one runtime dependency, and one is still a package
registry on the critical path. The projects that most need a tool for making
requirements legible are the governed ones, where installing anything at all is
a procurement conversation rather than a command — so a tool that can only
arrive through `npm install` cannot be evaluated by the person who needs it.
With this file committed, `git clone` is the entire install and `npm` is
optional. The reasoning is in [docs/09-delivery.md](../docs/09-delivery.md).

## Updating it

`yaml` stays in `devDependencies` — it is the source this file is built from,
so it is still a real dependency of the *build*, just not of running walkdown.

    npm install yaml@latest    # bump it
    npm run build:yaml         # rebuild the bundle
    npm test                   # and prove it still parses this project

`npm run check:yaml` (which Highball runs) rebuilds to a scratch path and
compares, so a stale bundle is a failing check rather than a surprise. That is
the trade this vendoring makes: updates become deliberate instead of
automatic. For a 260 KB file that changes a few times a year, deliberate is
the right side of that trade.

## Terms

`yaml` is ISC, by Eemeli Aro (`LICENSE`); `lit-html` is BSD-3-Clause, by
Google (`LICENSE-lit`). Each licence file is copied verbatim, and each bundle
carries a header pointing back here.

[yaml]: https://github.com/eemeli/yaml
[lit]: https://lit.dev
