# The walkdown guide

This guide says how to set walkdown up and build with a blueprint, as walkdown
works today. Read it top to bottom before your first feature. Each section says
what to do, in order, and links to the doc that says why.

It is written for the agent doing the work. The person you work for decides
what to build and signs for it; you draw up the rules, build, check and judge.
The blueprint's own `AGENTS.md` holds the conventions in short form, and this
guide is the long form of the same flow.

- [1. Set walkdown up](#1-set-walkdown-up)
- [2. What a blueprint holds](#2-what-a-blueprint-holds)
- [3. The flow, from a design request to a signed rule](#3-the-flow-from-a-design-request-to-a-signed-rule)
- [4. Design requests and designs](#4-design-requests-and-designs)
- [5. Rules and steps](#5-rules-and-steps)
- [6. Building, checks and the agent tier](#6-building-checks-and-the-agent-tier)
- [7. The walkdown and signatures](#7-the-walkdown-and-signatures)
- [8. As-built and redlines](#8-as-built-and-redlines)
- [9. More than one blueprint](#9-more-than-one-blueprint)
- [10. Where to read more](#10-where-to-read-more)

## 1. Set walkdown up

You are installing a tool in a repository that belongs to somebody else. Ask
before you write anything into it. The setup skill, `/walkdown:setup`, is the
same procedure with the questions to ask at each step
([skills/setup/SKILL.md](skills/setup/SKILL.md)).

### Check what is already there

    node --version          # 20 or newer
    git --version
    walkdown where          # answers if walkdown is installed and set up here

If `walkdown where` answers and the project already has a blueprint, setup is
done. Skip to [section 3](#3-the-flow-from-a-design-request-to-a-signed-rule).
If the clone is older than the latest tag, follow its
[UPGRADING.md](UPGRADING.md) section by section first.

### Clone it

walkdown is not on a package registry. The clone is the install. Ask where it
should go; `~/.walkdown/walkdown` is a good default.

    git clone --branch v0.4.1 https://github.com/profoundry-us/walkdown.git ~/.walkdown/walkdown
    node ~/.walkdown/walkdown/bin/walkdown.js --help

A tag is the stable copy, and `main` moves daily. Git may warn that the tag
"is not a commit". That is how it announces an annotated tag, and the clone is
fine.

Do not run `npm install`. The panel, the stylesheet and walkdown's one library
are committed, so there is nothing to install and nothing for an organisation
to approve. Offer to put it on the PATH:

    ln -s ~/.walkdown/walkdown/bin/walkdown.js ~/.local/bin/walkdown

Everywhere below, `walkdown` means that link or `node <clone>/bin/walkdown.js`.

### Get the machine ready

    walkdown init

It makes `~/.walkdown`, its registry and your `profile.yml`, which says who you
are and which roles you sign for. It links the skills into Claude Code and
checks for Node and git. It touches no project, and running it again is safe.

In Claude Code the skills arrive as one link, `~/.claude/skills/walkdown`,
pointing at the clone. They are `/walkdown:setup`, `/walkdown:formulate`,
`/walkdown:judge`, `/walkdown:incorporate` and `/walkdown:backlog`, with
`/walkdown:lint` and `/walkdown:status` beside them. Claude Code may list them
only from the next session. For another agent, name its skills folder and it
gets copies:

    walkdown skills --into <that agent's skills folder>

A bare `walkdown skills` asks where, and with no terminal to ask it writes
nothing. [docs/09-delivery.md](docs/09-delivery.md) says how the skills
are delivered and why.

### Make the project's blueprint

    walkdown blueprints new --dir <project-root>

By default the whole home lands in `~/.walkdown/projects/<project>/blueprints/`,
and the repository gets nothing. Ask whether the person wants it committed
instead. `--commit spec` puts it in `.walkdown/blueprints/` and keeps runs,
evidence and drafts out of git. `--commit all` commits everything. Spec is
right for a team; nothing is right for an evaluation. The choice can change
later, and the home moves whole:

    walkdown blueprints commit spec --blueprint <id>

The command prints the blueprint's ID (`0001-sh-shop`, say). Inside the project
its bare name (`shop`) works wherever the ID does. `walkdown blueprints` lists
them. [docs/08-locations.md](docs/08-locations.md) has the three arrangements
and where each puts the files.

With the spec committed, tell the project's agents where it is. Ask which file
they read, then place the pointer there:

    walkdown pointer --dir <project-root> --into CLAUDE.md

With nothing committed there is no pointer. `walkdown where` answers instead.

### Fill in spec.yml

`blueprints new` writes `spec.yml` beside the storyboard and a feature
template. Its `runner:` block says how to run the project's checks. Uncomment
the block for the project's framework. Each block loads walkdown's reporter
from the clone by its path, because no `walkdown` package is in the project's
`node_modules`. Copy the line it wrote rather than typing `walkdown/reporter`.

- Playwright: add the reporter path to the `reporter` array in
  `playwright.config`.
- RSpec: the formatter loads with `-I <clone>/adapters/rspec/lib -r
  walkdown/formatter`, so there is no gem to add.
- node:test: `--test-reporter=<clone>/lib/node-test-reporter.js`.

Set each target's `base_url` (`local` is `http://localhost:3000` until you
change it). Set `design.by` to `person` when a designer draws the screens, or
`agent` when a design agent does. [docs/03-runner-contract.md](docs/03-runner-contract.md)
has every key.

### Start the panel

    walkdown serve

One server answers for every blueprint on this machine, on
`http://localhost:4700` unless that port is taken. If one is already running,
start nothing: it picks up a new blueprint without a restart. Run it in the
background and give the person the address.

The browser extension is the one step only the person can do. Give them these
steps:

1. Open `chrome://extensions` and turn on Developer mode.
2. Choose Load unpacked, and pick the clone's `extension/` folder.
3. Visit the app under review and click the walkdown toolbar icon.

Setup ends with an empty blueprint. Do not invent rules to fill it. The next
step is `/walkdown:formulate`, from a design, a PRD or a conversation.

## 2. What a blueprint holds

A blueprint is one folder, its home. `walkdown where` names every path in it.

- `spec.yml`: how checks run, the targets, the design root.
- `storyboard.yml`: the screens, each with its design, its app path and its
  anchors.
- `features/*.yml`: features, their stories, and each story's rules.
- `threads/`: questions and notes, one file each.
- `runs/`: the ledger. Every check run, agent verdict and signed walkdown is
  one record, appended and never edited.
- `AGENTS.md`: the conventions, copied from walkdown. Read it before you build.

A rule's status is never stored. `walkdown status` works it out from the
runs, every time. So a rule is verified only when a run says so.

    walkdown status                  # every rule, and who each waiting item is for
    walkdown status <rule-id>        # one rule in full
    walkdown status --json           # the same, for you
    walkdown lint                    # everything that is wrong, errors first

[docs/02-blueprint-schema.md](docs/02-blueprint-schema.md) is the file format.
[docs/05-runs-ledger.md](docs/05-runs-ledger.md) is the ledger and how status is
worked out.

## 3. The flow, from a design request to a signed rule

Every screen goes through the same steps, in this order:

1. The screen goes in the storyboard with `design: null`, and a design request
   is filed on it.
2. Its rules are written, and its design is drawn. The two go back and forth
   until they agree. The builder never draws.
3. The design is proposed on the request. The person walks the rules with the
   proposed design beside them.
4. Approving every rule on the screen accepts its design. Sending one back
   sends the design back too.
5. You build the screen to the accepted design, and only then.
6. Checks prove what a script can prove, and the agent tier judges the rest.
7. The person walks the built rules and signs them.
8. Where the build cannot be framed, an as-built drawing stands in for it.
   Where the build leaves the design on purpose, the person pins a redline.

Nothing on a screen is built before its design is accepted. A screen built
first leaves its design to be guessed from the build, and nobody signed for
what it should have been.

## 4. Design requests and designs

A design is almost always a prototype: a page a person can open in the panel
and click. A CLI screen is the exception. It is one moment at a terminal, drawn
as a single page. [docs/06-prototype-contract.md](docs/06-prototype-contract.md)
is what a design must carry, and
[ADR 0015](docs/adr/foundational/202610_design_versions_and_states.md) is why
designs work this way.

### Never edit the design root

The design root is `designs/`, or whatever `design.root` in `spec.yml` names.
Design owns it. You never write into it while you build. Designs get there
through a request.

### File the request

Add the screen to the storyboard with no design yet:

```yaml
screens:
  - id: checkout-payment
    title: Payment step
    design: null
    anchors: [checkout.email, checkout.submit]
```

Leave `app:` out. A screen gets its app path when it is built, not before.
Then file the request on the screen:

    walkdown threads new --screen checkout-payment --reason request --as-agent \
      --body "The payment step: an email field, its error, and a pay button." --blueprint <id>

A request waits in the DESIGN QUEUE in `walkdown status`, never in yours. Lint
warns on a screen with no design and no open request.

### Who draws

A designer draws it when the person has one. Otherwise a design agent drafts
it. A design agent is a separate agent with its own instructions, never the
agent building the app (`design.by: agent` in `spec.yml`). Either way, the
rules for the screen are written alongside the design. A screen never reaches
the person without the rules it must show, and lint refuses a screen no rule
names.

### Versions and their states

Every design of a screen is one dated file in the screen's own folder:

```
designs/checkout-payment/20261019.html
designs/checkout-payment/20261019-v2.html    # a second version made the same day
```

Whoever drew it names the version on the request:

    walkdown threads set <request> --proposes /checkout-payment/20261019.html --blueprint <id>

It refuses a version no file holds. A design agent then marks the request
addressed, with a reply saying what it drew.

A version's state is in the record, never in its filename:

| State | What it means | How it gets there |
|---|---|---|
| proposed | waiting on a person | a live request's `proposes:` names it |
| accepted | the design of record | the request is accepted |
| superseded | an older accepted version, kept as history | a newer one is accepted |

A proposed version is edited in place. When the person sends it back, the
same file changes; no new version is made for an edit. An accepted version is
frozen. A change to it starts the next version, which is proposed until it is
accepted in turn.

### How a design is accepted

The walkdown is the design review. The panel shows a screen's proposed
version first, in a dashed yellow frame labelled "Proposed — yours to accept",
with an Accepted and Proposed switch when there is an older accepted version.
When the person approves every rule on the screen, the request is accepted in
their name. An agent's verdict never accepts a design.

After that, point the storyboard's `design:` at the accepted version. The
server never writes the storyboard, so lint warns until you do. Accepting a
new version also makes the built rules on that screen stale, so they are
judged again against it.

## 5. Rules and steps

`/walkdown:formulate` turns a design, a PRD or a conversation into screens,
stories and rules. It is the procedure for this section
([skills/formulate/SKILL.md](skills/formulate/SKILL.md)). The conventions are in
`AGENTS.md`, under "Writing a rule".

### A rule

```yaml
# features/checkout.yml
feature: checkout
title: Guest checkout
stories:
  - id: checkout.guest
    title: Guest completes a purchase
    statement: As a guest, I can buy without creating an account.
    rules:
      - id: checkout.guest.email-required
        origin: prd
        statement: A guest must give a valid email before payment is attempted.
        because: A payment with no way to reach the buyer is one nobody can follow up.
        verify: [checks]
        signoff: [eng, product]
        screens: [checkout-payment]
        focus: checkout.email
        steps:
          given:
            - A cart with one item, and nobody signed in
          when:
            - Visit screen `checkout-payment`
            - Leave anchor `checkout.email` blank
            - Click anchor `checkout.submit`
          then:
            - An error is visible at anchor `checkout.email-error`
            - No payment request is sent
```

- The id is `feature.story.slug`. It is given once and never changes.
- `statement` is the claim, in one or two sentences, written for a stranger.
  When the statement and the steps disagree, the statement wins.
- `because` is why the rule is worth having, in one breath. `history`, which
  is optional, is what happened, with its date.
- `steps` are given, when and then. They name screens and anchors by id, in
  backticks, never by URL or CSS. Every live rule has steps; lint errors
  without them.
- `verify: [checks]` asks for tests. Ask only for what a script can prove. The
  agent tier is assumed for every rule.
- `unverifiable:` excuses a tier, in a sentence a person could argue with. A
  rule with no screen excuses the agent tier, because there is nothing to look
  at.
- `signoff` is who signs: `eng` always, with `product` or `design` beside it.
- `focus` is the anchor the rule is about. Opening the rule scrolls there.
- `origin` is where the rule came from: `prd`, `prototype`, `thread:<id>` or
  `walkdown`.

[docs/13-voice.md](docs/13-voice.md) is how the words should sound, and lint
warns where a field misses it. [docs/02-blueprint-schema.md](docs/02-blueprint-schema.md)
has every field.

### Default to bug

A rule is a claim somebody could have decided differently and would sign. If
nobody would have wanted it another way, it is a bug. Write the check, and skip
the rule. Taste, such as sizes and spacing, is neither.

### Ask rather than guess

Where the source leaves something open, file a question. Put the question on
its first line, and offer the ways out when you know them:

    walkdown threads new --kind question --rule <rule> --as-agent --blueprint <id> \
      --body "Does the email error show on blur, or only on submit?" \
      --option "On submit :: the prototype shows it after a click" \
      --option "On blur :: it catches a typo sooner"

Prefer a rule to a question. "Should X be so?" is what a rule already asks
the person to sign. When an answer becomes a new rule, move the question onto
it with `walkdown threads set <q> --written-as <rule> --blueprint <id>`.

### Stamp and lint

    walkdown hash --write --blueprint <id>                    # after any edit to a statement or a step
    walkdown hash --write --reword "<why>" --blueprint <id>   # when only the words changed
    walkdown hash --write --changed "<why>" --blueprint <id>  # when a signed rule's meaning moved
    walkdown lint --no-checks                                 # until the structure is clean

The hash pins the statement, the steps and any excuse. A verdict given before
the wording moved reads as stale. `--reword` keeps the verdicts when the
meaning did not change. A plain write refuses a rule someone has signed: say
`--changed` or `--reword`, with why. The reason is kept on the rule, and the
panel shows it to whoever signs it again, beside the steps that changed.

## 6. Building, checks and the agent tier

Build a screen only once its design is accepted: its request is closed, and
the storyboard's `design:` names the accepted version. Then:

- Carry anchors verbatim from the design into the build. The attribute is
  `embed.anchor_attribute` in `spec.yml`, `data-testid` by default.
- Give the screen its `app:` path in the storyboard once the app serves it.

### Checks

Write tests in the project's own framework and style. Tag each with the rule it
claims, one rule per test, and select by anchor:

- Playwright: `test('...', { tag: '@rule:checkout.guest.email-required' }, ...)`
- RSpec: `rule: "checkout.guest.email-required"` metadata
- node:test: `@rule:checkout.guest.email-required` in the test's name

A test that guards a bug no rule covers stays untagged. Then run them:

    walkdown run --rule <rule-id>      # one rule
    walkdown run                       # every check
    walkdown lint                      # coverage, stale hashes, references

A check that passed but was never recorded does not count. The reporter
appends the run record, under the identity in your `profile.yml`. Check
`walkdown status <rule-id>` shows the checks cell filled.
[docs/03-runner-contract.md](docs/03-runner-contract.md) is how a test framework
plugs in.

### The agent tier

A rule you built, reworded or fixed owes the agent tier a fresh look before a
person sees it. `walkdown status` lists it under AGENT QUEUE as
`judge-first` or `rejudge`. Judge it with `/walkdown:judge`
([skills/judge/SKILL.md](skills/judge/SKILL.md)):

    walkdown judge <rule-id> --blueprint <id>     # prints the prompt for one rule

The prompt carries the statement, the steps, both surfaces' addresses, the
redlines, where evidence goes, and the project's own `governance:` lines. You
drive your own browser against both surfaces, save the evidence, and append a
`kind: walkdown` run with `actor: agent`. A fail files a note with
`--reason finding` and puts its id in the result.

An agent pass fills the agent tier and nothing else. It never stands in for a
person's signature.

### Your queue

AGENT QUEUE in `walkdown status` is your work. `/walkdown:incorporate`
([skills/incorporate/SKILL.md](skills/incorporate/SKILL.md)) is the procedure.

- An answered question is incorporated: fold the answer into the rule, then
  mark it `incorporated`.
- An open note is addressed: fix it, check it again, then mark it `addressed`
  with a reply saying what changed and which run checked it.
- Change threads only through `walkdown threads reply` and `walkdown threads
  set`, with `--as-agent` and `--blueprint <id>`. Never edit their YAML.
- You never set `verified` or `waived`. You claim work; a person accepts it.

`/walkdown:backlog` works the whole queue unattended, in waves.

## 7. The walkdown and signatures

A walkdown is a person stepping through rules in the panel, comparing the build
with the design. A signed verdict is that person's acceptance.

### What the person does

1. Opens the panel: the extension on the app's page, or `walkdown serve`'s
   address.
2. Clicks Start walkdown. Their name comes from their `profile.yml`.
3. Gives each rule a verdict:
   - A built rule gets Pass or Fail. A fail needs a why: a note in the
     feedback box, or a pin on the element.
   - An unbuilt rule gets Approve or Refine. Approve says build it as written.
     Refine needs the feedback that says what to change.
4. Clicks Finish walkdown. That appends one run to the ledger. Until then each
   verdict is kept as a draft, which survives a reload.

Before you hand rules to the person, make sure AGENT QUEUE in `walkdown
status` lists nothing for them. A person handed a rule no agent has looked at
is doing the agent's job.

### What a signature does

- It fills the rule's `signoff:` role. A person signs for the roles listed in
  their `profile.yml`, and only for roles they hold.
- A signed pass ends the rule's conversation. Every note on it that was open
  or addressed reads as verified.
- Approving every rule on a screen accepts its proposed design
  ([section 4](#how-a-design-is-accepted)).
- An approval is a verdict on the wording, not the build. It never fills a
  verify tier. The rule comes back for a real walkdown once it is built.

### When a verdict stops counting

A verdict is stale when the rule's wording has moved since it was given, or
when a new design was accepted for its screen. Code moving under a verdict does
not make it stale. To ask for every rule to be judged again, a person declares
a sweep:

    walkdown sweep --why "<reason>" --tiers agent --blueprint <id>

Never declare one yourself. It is the person's call.

A rule is verified when every tier it has shows a current pass and every
`signoff` role has signed. [docs/05-runs-ledger.md](docs/05-runs-ledger.md) has
the full table. [docs/08-locations.md](docs/08-locations.md) ("Signing for more
than one role") says who may sign for what.

## 8. As-built and redlines

### As-built, only where the build cannot be framed

The panel frames a web app's live page, so most projects never need an
as-built drawing. Keep one only for a build the panel cannot frame: browser
chrome, a native app, or a command line. It is an HTML page under `as-built/`,
carrying the screen's anchors, named as the screen's app path:

```yaml
  - id: review
    design: /review/20261019.html
    app: { path: /as-built/review.html }
```

It is engineering's to edit, and it should say on its face that it is a
drawing. It is never the design, and a verdict on it is a verdict on the
drawing. [ADR 0007](docs/adr/lightweight/202609_as_built_drawings.md) is the
reasoning.

A screen that is not built yet can borrow its own design as the app, with
`app: { path: /stand-in/<screen-id> }`. It is marked as a stand-in and is not
evidence. [docs/06-prototype-contract.md](docs/06-prototype-contract.md) covers
both.

### Redlines, filed only by a person

A redline says the build leaves the design at one element on purpose, and why.
The person files it from pin mode, by choosing redline in the pin form, or at a
terminal with `walkdown threads new --reason redline --screen <id> --element
<sel> --design "<what the design shows>" --build "<what the build shows>"
--body "<why>" --blueprint <id>`. It records what the design shows and what the
build shows, and either half may be left out. It is filed closed,
drawn in red on both sides of the fade, and listed apart in the Threads tab.

- You never file a redline. walkdown refuses one from an agent.
- When you think a gap is meant, ask a question on the element. If the person
  agrees, they file the redline.
- A judge reads a redline as an intended gap, not a fail, and names it in its
  reasoning.
- A person may reopen a redline. It becomes an open note waiting on you, with
  its why and its design and build pair kept.

## 9. More than one blueprint

A project can hold several, one per unrelated area:

    walkdown blueprints new <name> --dir <project-root>

Reads (`status`, `lint`, `threads`, `where`) report on each, a section apiece.
Every command that writes takes `--blueprint <id>`, even with one blueprint.
No write picks a blueprint from the folder it runs in. When it is unclear which
blueprint a rule belongs in, ask. Rules move with their verdicts:

    walkdown rules move <rule> --blueprint <from> --to <id> --dry-run

## 10. Where to read more

| For | Read |
|---|---|
| The conventions, in short form | the blueprint's `AGENTS.md` ([lib/templates/AGENTS.md](lib/templates/AGENTS.md)) |
| Every command and its flags | `walkdown help`, and `walkdown <noun> help` |
| What walkdown is for | [docs/00-vision.md](docs/00-vision.md) |
| Every term, one meaning | [docs/01-glossary.md](docs/01-glossary.md) |
| The file format | [docs/02-blueprint-schema.md](docs/02-blueprint-schema.md) |
| Plugging in a test framework | [docs/03-runner-contract.md](docs/03-runner-contract.md) |
| Anchors, the embed and the panel | [docs/04-embed-and-anchors.md](docs/04-embed-and-anchors.md) |
| Runs, walkdowns and status | [docs/05-runs-ledger.md](docs/05-runs-ledger.md) |
| What a design must carry | [docs/06-prototype-contract.md](docs/06-prototype-contract.md) |
| Where the files live | [docs/08-locations.md](docs/08-locations.md) |
| How walkdown is delivered | [docs/09-delivery.md](docs/09-delivery.md) |
| How the words should sound | [docs/13-voice.md](docs/13-voice.md) |
| Why a decision was made | [docs/adr/](docs/adr/) |
| Moving to a newer version | [UPGRADING.md](UPGRADING.md) |
