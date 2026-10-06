# Architectural Decision Records

Each ADR records one decision about walkdown: its context, what was decided, what
was rejected, and what follows from it.

Names follow [LocoMotion's conventions](https://github.com/profoundry-us/loco_motion/blob/main/docs/ADRs/README.md):
`YYYYMM_the_decision_to_be_made.md`, for the month the ADR began. A file is named
for the question, not the answer. Two kinds sit in their own folders:

- **`foundational/`**: decisions about walkdown as a whole. Read these to learn
  why it works the way it does.
- **`lightweight/`**: smaller decisions about one piece. Look these up when that
  piece is in question.

Every ADR also has a number, which is how it is cited ("ADR 0003") in code,
rules, threads and run records. The number never changes, even when the file
is renamed.

| ADR  | Decision | Kind | Status |
|------|----------|------|--------|
| 0001 | [Page to blueprint routing](foundational/202609_page_to_blueprint_routing.md) | foundational | accepted |
| 0002 | [Claude Desktop extension support](lightweight/202609_claude_desktop_extension_support.md) | lightweight | accepted |
| 0003 | [How blueprints are found](foundational/202609_how_blueprints_are_found.md) | foundational | accepted |
| 0004 | [Rule wording guidelines](foundational/202609_rule_wording_guidelines.md) | foundational | accepted |
| 0005 | [Who closes a thread](lightweight/202609_who_closes_a_thread.md) | lightweight | accepted |
| 0006 | [Where conversations about rules live](foundational/202609_where_conversations_about_rules_live.md) | foundational | accepted |
| 0007 | [Screens that cannot be framed](lightweight/202609_screens_that_cannot_be_framed.md) | lightweight | accepted |
| 0008 | [Whose turn a rule is](lightweight/202609_whose_turn_a_rule_is.md) | lightweight | proposed |
| 0009 | [Who draws the design](foundational/202609_who_draws_the_design.md) | foundational | accepted |
| 0010 | [Claude Code skill packaging](foundational/202610_claude_code_skill_packaging.md) | foundational | accepted |
| 0011 | [Several blueprints per project](foundational/202610_several_blueprints_per_project.md) | foundational | accepted |
| 0012 | [CLI command structure](foundational/202610_cli_command_structure.md) | foundational | accepted |
| 0013 | [A project split into blueprints](foundational/202610_a_project_split_into_blueprints.md) | foundational | accepted |
| 0014 | [Where walkdown keeps its files](foundational/202610_where_walkdown_keeps_its_files.md) | foundational | proposed |

A new ADR takes the next number and the current month:
`docs/adr/foundational/202610_<question>.md`, with `# ADR NNNN — <Question>` as its
first line. Add it to this table.
