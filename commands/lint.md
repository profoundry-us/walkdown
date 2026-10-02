---
description: Lint this project's walkdown blueprint and report what needs fixing
argument-hint: "[--blueprint <id>]"
allowed-tools: Bash(node:*)
---

walkdown's lint, run from the plugin's own clone:

!`node "${CLAUDE_PLUGIN_ROOT}/bin/walkdown.js" lint $ARGUMENTS 2>&1`

Report what it said: the errors first, each with the file and rule it names and
what would fix it, then how many warnings there are. Change nothing unless asked.
