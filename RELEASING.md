# Releasing walkdown

How a version of walkdown is released, in order. Each step is here because a
release once went out without it.

## Before cutting it

1. **Nothing is owed.** `node bin/walkdown.js status` shows nothing waiting on a
   person or the agent that this release means to ship. `node tools/sitting.mjs
   owed` reads 0, `node bin/walkdown.js lint` shows no errors, and the working
   tree is clean.
2. **What was built matches what was decided.** For every ADR this release
   builds, read it against what shipped. Fix the build where it fell short. If
   the build taught us something, update the ADR instead.
3. **The guide is brought up to date.** `GUIDE.md` says how to build with a
   blueprint as walkdown is today (ADR 0015). Rewrite whatever this release
   changed, from what shipped rather than from the ADR. It is what agents are
   pointed to, so it is current before the tag, never after. (Until `GUIDE.md`
   exists, this step is the docs under `docs/` that describe what changed.)
4. **The changelog's Unreleased section covers everything since the last tag.**
   Walk `git log v<last>..HEAD` for what a person or an agent using walkdown
   would notice, and add what is missing. Each entry says what changed, in
   their words.
5. **The upgrade guide says what to do.** `UPGRADING.md` gains a "From <last> to
   <new>" section: the commands to check out the tag, and anything else an
   existing install must do. Write "nothing else" when that is true.

## Cutting it

6. **Move the version** in `package.json` and `package-lock.json` (its top two
   `version` fields), `.claude-plugin/plugin.json` and `extension/manifest.json`.
7. **Pin the install instructions** to the new tag: `README.md`,
   `site/setup.md`, `skills/setup/SKILL.md` and the clone line in
   `docs/09-delivery.md`.
8. **Record the skill hashes:** `node tools/released-skills.mjs`, then `--check`.
   The tag carries its own hashes, so the installer can tell a copy this version
   left from one its person edited.
9. **Turn Unreleased into the version:** a `## [x.y.z] - YYYY-MM-DD` heading
   under `## [Unreleased]`, and its compare link at the foot of the changelog.
10. **Test what a release touches:** `node --test test/delivery.test.js
    test/plugin.test.js test/init-run.test.js`.
11. **Commit** as `x.y.z: the install instructions pin this version`, and tag
    it annotated: `git tag -a vx.y.z`, with a short summary of the release as
    its message.
12. **Push** main and the tag, then make the GitHub release from the
    changelog's section: `gh release create vx.y.z --title "walkdown x.y.z"
    --notes-file <that section>`.

## After it is out

13. **Redeploy walkdown.dev.** In the `walkdown-site` checkout beside this one:
    `npm run sync:setup`, commit, `fly deploy` for staging, check
    `https://staging.walkdown.dev/setup` names the new tag, then
    `fly deploy -c fly.production.toml` and check `https://walkdown.dev/setup`.
    Push the site repository.
14. **Check nothing still names the old tag:** `curl -s
    https://walkdown.dev/setup | grep -c v<last>` reads 0.
