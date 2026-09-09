# 12 — Page ownership: one question doing two jobs

Written 2026-09-09, when the constraint the routing was built on met a case it
was never meant to hold. Nothing here is decided; it is the argument, laid out
so it can be argued with. The decision lives on the board as
[q-0269](../.walkdown/blueprints/0001-walkdown/threads/q-0269.yml).

## The sentence everything rests on

From q-0019, 2026-08-24, Topher:

> A page belongs to exactly one blueprint — a hard constraint, not a
> preference. The same page covered by two blueprints is a case we do not
> want, so the picker never has to disambiguate and a pin never has to ask
> which project it belongs to.

That sentence is load-bearing. It is why `/api/whose` can answer, why the panel
opens without asking, why a pin dropped on a page nobody tagged still lands in
the right project's threads, and why "two blueprints claim this page" is
reported as a fault rather than as a listing.

On 2026-09-09 it met two cases from the work actually coming:

1. One site hosting several blueprints at various paths — the monorepo packs
   structure.
2. Several blueprints covering the **same** page, because they are about
   different functionality of it. Two teams, one homepage.

## What is already true, measured

The first case is not a problem and never was. A claim has always been an
**origin plus a path**, so `shop.test/checkout` and `shop.test/admin` are two
claims and not a collision. `claimsOf` builds one claim per screen per target;
`collisions` reports only where the same origin *and* the same path are claimed
twice. A monolith whose packs each enumerate their own pages is already served,
already routed, already lint-clean.

So the rethink is not "multi-blueprint sites". It is exactly one thing: **may
two blueprints claim the same page?**

Worth knowing before answering: `blueprintForUrl` does not fail on ambiguity
today, it *ranks*. A fragment beats a bare path, a longer path beats a shorter
one, and the highest score wins. There is no tie-break and no report when two
claims score the same — the set is assumed collision-free because a check
enforces it elsewhere. Relax the constraint without touching that function and
the panel will silently pick one, which is the failure mode this whole area
exists to prevent.

## The reframe

Today one question does two jobs, and they are not the same kind of thing:

- **Which blueprints could this page belong to?** A *fact*, read from claims.
  It is allowed to answer with several, the way any honest index is.
- **Which one am I reviewing it against right now?** A *choice*. It belongs to
  the panel and the person holding it, it is changeable, and it is remembered
  as a default rather than recorded as a fact about the project.

The constraint exists because those two were one question. Split them and it
stops being needed for its own sake — what it was really protecting is that the
second question always has an answer without anybody being asked.

## What each behaviour becomes

### Opening a page

*Today:* zero claimants → the unclaimed screen. One claimant → it opens.

*Split:* zero → unchanged. One → unchanged, and this stays the overwhelmingly
common case. Several → the panel asks, naming the claimants, and remembers the
answer as this person's default for that page.

That last line is a job for the picker — a real one, from the page's own
claims, rather than from a count of what a folder happens to hold. It is a
better answer to [q-0262](../.walkdown/blueprints/0001-walkdown/threads/q-0262.yml)
than retiring the screen: the question "which of these is this page?" becomes
answerable exactly when it is worth asking.

### Filing a pin from an untagged page

*Today:* the address names the project, so feedback lands right without anyone
choosing — `embed.pin.right-project`, and the reason the constraint was wanted.

*Split:* with one claimant, unchanged. With several, the pin follows **the
blueprint you have open**, because by then opening was a deliberate act and the
panel knows what you are reviewing against. A pin from a page you have not
opened — which is the case that rule was written for — still has exactly one
claimant in every situation we have today, so nothing regresses until somebody
deliberately double-claims a page.

The thing to avoid is a pin dialogue that asks which project this is about.
That was the case Topher ruled out, and it stays ruled out: the answer comes
from the session, never from a question at filing time.

### Reporting collisions

*Today:* two claimants is a fault, reported across the whole set by the one
check that can see more than one blueprint.

*Split:* it stops being a fault by itself and becomes an inventory — *these
pages are covered by more than one blueprint, and here they are.* Two things
are worth keeping as faults even then, and they are the interesting half:

- Two blueprints claiming a page where **neither says so deliberately**. A
  collision that nobody declared is still almost always a mistake.
- A page whose claimants disagree about what it *is* — different screen ids
  are fine, but the same screen id claimed twice is two projects believing
  they own one name.

That suggests a claim grows a way of saying "yes, I know I share this page",
which is the smallest possible change to the data and the thing that keeps the
check honest. It is also the part most likely to be wrong on first draft.

### Remembering

*Today:* a pick is remembered in the browser, which is the two-kinds-of-memory
problem that started this — the project says one thing, a browser profile says
another, and they part company at the second machine.

*Split:* the two memories stop competing because they answer different
questions. A **claim** is written down in the project: durable, shared, the
answer to "could this page belong here". A **default** is what you last chose
among several claimants: local, disposable, and never consulted where a claim
answers. Losing a default costs one press; losing a claim costs the project's
knowledge of itself, and only one of them is worth writing to disk.

This is also what unblocks
[q-0267](../.walkdown/blueprints/0001-walkdown/threads/q-0267.yml). Under the
split, "picking is claiming" applies only where there are **no** claimants —
you are telling the project something it does not know. Choosing among several
claimants writes nothing at all. So the write the browser would be asking to
make is narrower than the question currently assumes: not "record my choice",
but "record that this site is covered", once, in the one case where nothing
covers it yet.

### Judging and the ledger

Unaffected, and worth saying so. A run records the address it was made against;
two blueprints judging one address record separately against their own rules,
and neither reads the other's verdicts. Nothing in the ledger assumes a page
has one owner.

## The rules this touches

| rule | what happens to it |
|---|---|
| `screens.ownership.one-claimant` | The statement is the constraint. It either narrows to *undeclared* collisions, or it retires. |
| `screens.ownership.routes-by-page` | Survives, and its statement stays true: the answer still comes from the address, not from what was chosen last. It gains a case — the address answering with several. |
| `embed.pin.right-project` | Survives. Add the tie-break: where the address answers with several, the pin follows the open blueprint. |
| `panel.start.choose-a-blueprint` | Gets a reason to exist that is not a count: several claimants, named. |
| `panel.start.unclaimed-page-says-so` | Untouched — it is about zero claimants, which is a different screen and stays one. |
| `ownership.writes.spec-never-implementation` | Still the gate on q-0267, but over a smaller write than the question currently describes. |

## What was rejected, and why

- **Leave the constraint, tell people to split the page into two screens.**
  Honest, and it costs nothing to build. It fails on the actual case: two
  blueprints about *different functionality of one page* are not two pages, and
  making the storyboard pretend otherwise puts a lie in the spec to protect an
  invariant that exists for the tooling's convenience.
- **Let claims collide and have the panel pick silently by rank.** This is what
  the code would do today if the check were removed, which is exactly why it
  should not be: a silent pick among claimants is the panel deciding whose page
  this is, and four judgings this week were about nothing else.
- **Make the choice a claim too — record "I am reviewing this page against X"
  in the project.** Tempting, because it collapses everything into one
  mechanism. Rejected: a preference held by one person at one moment does not
  belong in a file everyone reads, and writing it there means a teammate's
  choice changes what your panel opens.

## What it would cost

Small in the parts that matter, and the risk is concentrated in one place.

- Answering "whose page is this" with a *list* rather than a best match, and
  keeping the ranking only as the tie-break within one blueprint.
- A picker fed by that list, and a local default per page.
- The pin path preferring the open blueprint before falling back to the
  address.
- The collision check becoming an inventory plus a narrower fault.

The risk is `blueprintForUrl`. Every road into this area goes through it, it
currently answers with one thing, and every caller is written to that shape.
Changing it is a day; changing it *and* leaving a caller reading the old shape
is a silent wrong-project bug, which is the family of bug this repository has
spent a fortnight paying for.

## What is still open

1. May two blueprints claim the same page at all? Everything above assumes yes;
   if the answer is no, this document is one paragraph and the case gets
   handled by splitting screens.
2. If yes: must a shared claim be declared as shared, so an undeclared
   collision stays a fault?
3. Where does the default live — per page, or per site? Per page is more
   precise and forgets more often; per site is what the old remembered choice
   did and is wrong the moment one site has two claimed pages that differ.
4. Does a pin ever ask? This document says never, on the strength of the
   sentence in q-0019. Worth confirming that still holds.
