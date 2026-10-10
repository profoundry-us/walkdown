# Architectural Decision Records

Each ADR records one decision about walkdown: its context, what was decided, what
was rejected, and what follows from it.

Names follow [LocoMotion's conventions](https://github.com/profoundry-us/loco_motion/blob/main/docs/ADRs/README.md):
`YYYYMM_<topic>.md`, for the month the ADR began. Two kinds sit in their own
folders:

- **`foundational/`**: decisions about walkdown as a whole. Read these to learn
  why it works the way it does.
- **`lightweight/`**: smaller decisions about one piece. Look these up when that
  piece is in question.

## Naming an ADR

The name is the **topic** the decision is about, as a short noun phrase: the
words someone would search for, not the answer and not a question.

- A noun phrase, ideally two to four words, five at most.
- It names the thing decided about (`blueprint_registry`, `cli_command_structure`).
- It does not start with a question word (`who`, `what`, `where`, `whose`, `how`,
  `when`, `which`, `why`) or an article (`a`, `an`, `the`).
- It does not state the decision (`rules_are_easy_to_understand`).
- The heading is the same name in sentence case: `# ADR 0003 — Blueprint registry`.

| Instead of | Name it |
|---|---|
| `how_blueprints_are_found` | `blueprint_registry` |
| `who_closes_a_thread` | `thread_closing_permissions` |
| `screens_that_cannot_be_framed` | `as_built_drawings` |
| `whose_turn_a_rule_is` | `rule_attention_queues` |
| `who_draws_the_design` | `design_ownership_and_requests` |
| `a_project_split_into_blueprints` | `panel_and_cli_blueprint_split` |
| `where_walkdown_keeps_its_files` | `file_layout_and_locations` |
| `rules_are_easy_to_understand` | `rule_wording_guidelines` |

Highball refuses a new name that breaks these rules (`.highball/checks/adr-names`).

Every ADR also has a number, which is how it is cited ("ADR 0003") in code,
rules, threads and run records. The number never changes, even when the file
is renamed.

| ADR  | Decision | Kind | Status |
|------|----------|------|--------|
| 0001 | [Page to blueprint routing](foundational/202609_page_to_blueprint_routing.md) | foundational | accepted |
| 0002 | [Claude Desktop extension support](lightweight/202609_claude_desktop_extension_support.md) | lightweight | accepted |
| 0003 | [Blueprint registry](foundational/202609_blueprint_registry.md) | foundational | accepted |
| 0004 | [Rule wording guidelines](foundational/202609_rule_wording_guidelines.md) | foundational | accepted |
| 0005 | [Thread closing permissions](lightweight/202609_thread_closing_permissions.md) | lightweight | accepted |
| 0006 | [Rule conversation threads](foundational/202609_rule_conversation_threads.md) | foundational | accepted |
| 0007 | [As-built drawings](lightweight/202609_as_built_drawings.md) | lightweight | accepted |
| 0008 | [Rule attention queues](lightweight/202609_rule_attention_queues.md) | lightweight | proposed |
| 0009 | [Design ownership and requests](foundational/202609_design_ownership_and_requests.md) | foundational | accepted |
| 0010 | [Claude Code skill packaging](foundational/202610_claude_code_skill_packaging.md) | foundational | accepted |
| 0011 | [Multiple blueprints per project](foundational/202610_multiple_blueprints_per_project.md) | foundational | accepted |
| 0012 | [CLI command structure](foundational/202610_cli_command_structure.md) | foundational | accepted |
| 0013 | [Panel and CLI blueprint split](foundational/202610_panel_and_cli_blueprint_split.md) | foundational | accepted |
| 0014 | [File layout and locations](foundational/202610_file_layout_and_locations.md) | foundational | accepted |
| 0015 | [Prototype versions and states](foundational/202610_prototype_versions_and_states.md) | foundational | accepted |
| 0016 | [Rule focus](lightweight/202610_rule_focus.md) | lightweight | proposed |

A new ADR takes the next number and the current month:
`docs/adr/foundational/202610_<topic>.md`, with `# ADR NNNN — <Topic>` as its
first line. Add it to this table.
