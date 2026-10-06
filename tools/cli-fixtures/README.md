Fixtures for cli screens, a file per group. Each `*.mjs` default-exports
an object of fixtures by name, `(m, h) => { ... }`. `m` is the throwaway
machine from `tools/cli-scenarios.mjs` (`m.root`, `m.home`, `m.shop`,
`m.wd(args, cwd)`, `m.ok(args)`, `m.specOf(id)`). `h` holds its helpers:
`feature`, `git`, `realRepo`, `committedHome`, and `fixtures` (the
built-in ones by name, to build on).
