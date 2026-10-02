---
description: Show this project's walkdown status - what passes, and who each waiting item is for
argument-hint: "[<rule-id>] [--blueprint <id>]"
allowed-tools: Bash(node:*)
---

walkdown's status report, run from the plugin's own clone:

!`node "${CLAUDE_PLUGIN_ROOT}/bin/walkdown.js" status $ARGUMENTS 2>&1`

Report what it said: the counts, then each queue in the order it gives them
(what waits on a person, on design, on the agent), naming the rules. Change
nothing unless asked.
