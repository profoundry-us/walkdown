# ADR 0001 — Projects, blueprints, and how a page finds them

- **Status:** accepted
- **Date:** 2026-09-09
- **Deciders:** Topher (product, eng)
- **Supersedes:** the routing half of q-0019 (2026-08-24), specifically the
  one-page-one-blueprint constraint
- **Argument:** [docs/12-page-ownership.md](../12-page-ownership.md) is the
  reasoning this decision came out of; this file is what was decided
- **Threads:** q-0269 (reopening), q-0262, q-0267, q-0268

## Context

Routing was built on one sentence, recorded in q-0019 on 2026-08-24:

> A page belongs to exactly one blueprint — a hard constraint, not a
> preference. The same page covered by two blueprints is a case we do not
> want, so the picker never has to disambiguate and a pin never has to ask
> which project it belongs to.

Everything downstream rests on it: `/api/whose` can answer with one thing, the
panel opens without asking, a pin dropped on a page nobody tagged still lands
in the right ledger, and two blueprints claiming one page is reported as a
fault by a check that runs on every edit.

On 2026-09-09 that sentence met the work actually coming.

1. **A monolith's packs.** One site, several blueprints at different paths.
   This was never a problem — a claim has always been an origin *plus* a path,
   so `shop.acme.test/checkout` and `shop.acme.test/admin` are two claims and
   not a collision. Measured before deciding anything, which is what kept the
   rest of this short.
2. **Two blueprints covering one page.** Two efforts about different
   functionality of the same homepage. This the constraint forbids outright,
   and no amount of splitting screens makes it honest: they are not two pages.

A second thing surfaced while drawing it. What the code calls a *project* is a
blueprint — an entry a `.walkdown` declares. What a person calls a project is
the repository those live in. One word, two meanings, in a tool whose entire
premise is that a term means one thing.

Third, the panel remembered which blueprint you last picked for a site, in the
browser. That is a second kind of memory about a fact the project already
holds: your laptop knows, your other machine does not, your teammate does not,
and the board cannot see it at all.

## Decision

### 1. A page may be claimed by more than one blueprint

The one-claimant constraint is withdrawn. `screens.ownership.one-claimant`
retires, and the Highball check enforcing it goes with it.

Collisions are not declared. Nothing marks a claim as deliberately shared;
walkdown works out who claims an address and reports what it finds. The cost is
accepted with open eyes: an *accidental* double-claim now surfaces as a
question to the person rather than as an error at lint time.

### 2. Project and blueprint are two concepts, and two words

- A **project** is a directory you have imported — normally a repository. It is
  the thing a person means by "what I am working on".
- A **blueprint** is a specification inside one, with its own storyboard,
  rules, threads and runs.

`01-glossary.md` gains both, and the payload field currently called `projects`
becomes `blueprints`. Every surface that says "project" today and means
blueprint is wrong and gets renamed.

### 3. The server serves every imported project, whatever directory it was started in

A walkdown server is no longer bound to the `.walkdown` above its working
directory. It offers the machine's registry: every project you have imported,
and nothing else.

This is deliberately the opposite of what `locations.answer.one-walkdown-answers`
was built to stop. That rule exists because a server once *inferred* another
repository's blueprints by walking up the tree, then served and wrote to them
with nobody having asked. The registry is the same capability with the opposite
provenance: an explicit list, maintained by hand, nothing in it by accident.
The rule's wording moves to forbid inference rather than breadth.

Nothing undeclared is ever visible. Clone a repository that happens to use
walkdown and you will not see its blueprints until you import it.

### 4. `walkdown import` is how a project joins the registry

    walkdown import <path>

Discovers the blueprints under a path and asks which to take. Several found
means a prompt, and the person decides — all, some, one. Import writes a
pointer, not a copy: the blueprint stays where it is, in a repository or under
`~/.walkdown` if it is not ready to live in one yet.

`init` and `import` are the only two ways a project enters the registry, and
both are commands a person runs. **Neither ever runs from the browser.**

### 5. Import writes a claims index; `serve` refreshes it

A claim lives inside a blueprint's specification — a target's `base_url` and a
screen's `app` path — so answering "who claims this address" by reading specs
means loading every blueprint on the machine on every request. That was already
flagged as untenable in q-0019 and is worse now that the scope is a machine
rather than a repository.

So import writes the claims into the registry as an index, and `serve`
refreshes it at startup. The index is a cache and is treated as one: it is
derived, it is rebuilt, and it is never the authority. Editing a storyboard
mid-session leaves it stale until the next serve, which is accepted for now.

### 6. `blueprintsForUrl` answers with a list

Renamed from `blueprintForUrl`, and it stops choosing. Ranking — a fragment
beats a bare path, a longer path beats a shorter one — survives **within** one
blueprint, because that is how a screen is identified at all. It is abandoned
**across** blueprints: a silent pick between two projects' claims is the panel
deciding whose page you are on, which is the fault four judgings removed this
week.

### 7. What loads, in every case

| You open | Claims found | What happens |
|---|---|---|
| a page | exactly 1 | Load that project, activate that blueprint, show **Rules**. Nothing is asked. |
| a page | several, one project | Load the project, show **Blueprints** with a notice saying how many claim this page; matching ones grouped and marked at the top. |
| a page | several, several projects | **Project modal.** Matching projects first, each naming the blueprint that matched. Choosing one then follows the two rows above. |
| a page | none | **Project modal**, same screen as the server root below. |
| the walkdown server root | not asked | **Project modal**, listing everything imported. |
| — (at will) | — | The project switcher in the panel bar opens the same modal. |

Choosing a project with exactly one blueprint activates it and shows Rules.
Choosing one with several shows Blueprints.

### 8. Choosing a blueprint may move you

Picking a blueprint that covers the page you are on leaves you where you are —
you are already where the choice meant to put you. Picking one that does not
takes you to its front door, because reviewing a blueprint against a page it
has never heard of is not a thing anybody meant to ask for.

### 9. Nothing is remembered

No defaults, per page or per site. Ambiguity asks every time, and the browser
stores no choice at all. The remembered-choice storage is deleted rather than
migrated.

This is a deliberate simplification and is expected to be revisited once the
rest settles; asking twice is cheap, and a wrong memory is not.

### 10. The Blueprints tab shows the active project's blueprints

Not the server's, and not the domain's. Blueprints claiming the current page
are grouped and marked at the top; the rest of the project's follow, still
reachable. Sorting and filtering are expected once a project holds many.

### 11. The panel bar reads project / blueprint / screen

The project is a control, not a label: it opens the modal. Crossing projects
stays deliberate — there is otherwise no way to reach another project without
changing the address or going back to the server root.

### 12. A pin files against the active blueprint

Always. The server stops re-routing a write by looking up the page's address
and overriding what the caller said. Under this design the panel always has an
active blueprint, so it names one, and the server never guesses.

`embed.pin.right-project` keeps its promise by a different mechanism: you
cannot be reviewing a page without having chosen what you are reviewing it
against.

## Consequences

### Good

- The case that broke the old model is served: two efforts, one page, no lie in
  either storyboard.
- One kind of memory. A claim is written down in the project; nothing competes
  with it from a browser profile.
- The blueprint chooser gets a reason to exist that is not a count, which is
  what four judgings this week objected to.
- Nothing undeclared is ever listed, served, or written to — a stronger
  guarantee than the tree-walk it replaces.
- The panel's account of what it is doing gets simpler, not more complex: it
  asks when it does not know, and never otherwise.

### Bad, and accepted

- An accidental double-claim is now a question rather than an error.
- The claims index can go stale between serves.
- Several rule statements are reworded, which un-signs them; each comes back to
  a person for acceptance. That is a chunk of Topher's time and it is the
  price of the change being visible.
- `blueprintForUrl` is on every road into this area and every caller is written
  to its single-answer shape. Changing it while leaving one caller reading the
  old shape is a silent wrong-project bug, which is the exact family this
  repository has spent a fortnight paying for. This is the risk of the whole
  ADR, concentrated in one function.

### Deferred, deliberately

- **Several projects at one origin and path.** Two projects both claiming
  `localhost:3000/` cannot be told apart by address alone. A page could declare
  which project it belongs to, in a meta tag or a header. Not solved now.
- **Several `.walkdown` directories in one repository.** The registry treats a
  project as one directory; a repository holding two is not modelled.
- **Sorting and filtering the Blueprints tab**, for a project with many.
- **Remembering a choice**, per §9.

## Rules affected

| rule | change |
|---|---|
| `screens.ownership.one-claimant` | retires — the constraint it enforces is withdrawn |
| `screens.ownership.routes-by-page` | reworded: the address still answers, and may answer with several |
| `panel.start.choose-a-blueprint` | reworded: several *claimants*, never a count of what a folder holds |
| `embed.pin.right-project` | reworded: the active blueprint, chosen deliberately |
| `locations.answer.one-walkdown-answers` | reworded: forbids inference, not breadth |
| `panel.start.unclaimed-page-says-so` | folds into the project modal, which now covers both no-claimant cases |
| `ownership.writes.spec-never-implementation` | unchanged, and q-0267 is parked: nothing writes spec from the browser |
| *new* | the project modal, and what each of the six cases loads |

## Alternatives considered

- **Keep the constraint; split the page into two screens.** Costs nothing to
  build and fails the actual case — two efforts about one page are not two
  pages, and making the storyboard say otherwise puts a lie in the spec to
  protect an invariant that exists for the tooling's convenience.
- **Let claims collide and pick the best match silently.** What the code would
  do today if the check were removed, and exactly why it must not: a silent
  pick among claimants is the panel deciding whose page this is.
- **Declare shared claims, so an undeclared collision stays a fault.**
  Rejected as a concept nobody would maintain; the index works it out.
- **Record the choice as a claim too.** Tempting — one mechanism for
  everything. Rejected: a preference held by one person at one moment does not
  belong in a file everyone reads, and a teammate's choice would change what
  your panel opens.
- **Scope the server to its directory and switch projects by restarting it.**
  Honest and cheap, and it makes the common act — looking at another project —
  a terminal round trip. Rejected on use, not on principle.

## How it gets built

In this order, because each step leaves the tree working:

1. The claims index and `blueprintsForUrl`, with the old name gone in the same
   commit as its callers.
2. `walkdown import`, and the registry shape it writes.
3. The server: serve the registry, answer `/api/whose` with a list, stop
   re-routing writes.
4. The panel: the six cases, the modal, the tab, the switcher.
5. The vocabulary rename, last, when nothing else is moving.
6. The rules: retire, reword, add. Statement hashes rewritten, acceptance
   requeued.

Checks that enforce the old model are disabled as they are reached rather than
left failing, and are removed or replaced by the end. A check turned off is
recorded here:

- Highball `one-page-one-blueprint` — off from step 1, deleted at step 6
  (2026-09-09), along with the rule it enforced.
- Highball `unit-tests` ran at turn end only while the ADR was built, because a
  rename lands before its callers and a suite dumped after every edit hides the
  edit's own result. Back to per-edit at step 6.

Two surfaces named in §2 were deliberately left saying the old word, and
[q-0270](../../.walkdown/blueprints/0001-walkdown/threads/q-0270.yml) is where
they are decided: the config key `projects:`, which is a file format with data
in every clone and in the person's own `~/.walkdown/config.yml`, and
`resolveLocations({ project })`. Renaming either is a compatibility decision
rather than a tidy, and the second is 56 test call sites in the file this
repository has paid the most for.

The project modal ships without a design: `prototype/` is design's, the sketch
is `proposals/project-modal.html`, and
[n-0271](../../.walkdown/blueprints/0001-walkdown/threads/n-0271.yml) is the
request.
