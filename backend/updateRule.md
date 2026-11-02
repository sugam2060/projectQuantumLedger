# updateRule.md: How to Maintain AGENTS.md and CLAUDE.md

Read this when a task changes the project's structure, tooling, or conventions, or when you are corrected on something repeatable. Goal: keep agent instruction files accurate and small.

## File roles

- `AGENTS.md`: shared rules for all agents (Claude Code, Copilot, Cursor, Codex). Default place for any new rule.
- `CLAUDE.md`: starts with `@AGENTS.md`; only Claude Code-specific content (subagents, `/skill`, MCP).
- `src/<module>/AGENTS.md`: rules that apply to one module only.
- `.github/copilot-instructions.md`, `.cursor/rules/*`: short summaries that point to `AGENTS.md`. Update only if the rule is core, and never copy full text.
- Long procedures go in `docs/` or skills, linked from `AGENTS.md`.

## Update when

- A command, npm script, or env var is added, renamed, or removed.
- A module or directory is added or restructured, or a new pattern or library is adopted or dropped.
- A rule no longer matches the code.
- The user corrects you on the same kind of mistake twice. Add one line that prevents it.
- A module develops its own conventions (create a nested `AGENTS.md` there).

## Do NOT update for

- Individual features, endpoints, schemas, or one-off fixes.
- Anything discoverable by reading the code, `package.json`, or `ls`.
- Temporary state, TODOs, or task notes.

## How to update

1. Pick the right file using File roles. Prefer a nested `AGENTS.md` for module-specific rules.
2. Edit existing rules in place; don't append duplicates. Search for the rule first.
3. Write each rule as one imperative line, specific and checkable. No filler, no examples unless essential.
4. Prune: for every line added, remove or merge an obsolete one.
5. Verify before writing: referenced paths exist, npm scripts exist in `package.json`, versions match.
6. Keep `AGENTS.md` under ~150 lines. If an edit would exceed that, move detail to a nested file or `docs/` and leave a link.
7. Never remove or weaken the TDD workflow, the service/controller separation, or the NestJS building blocks rules unless the user explicitly asks.
8. Never put secrets, tokens, or real env values in these files.

## After updating

- Show the user a diff summary: what changed and why (one line per change).
- Do not commit. The user reviews instruction-file changes like code.
- If unsure a rule belongs, ask instead of adding it.

## Periodic audit (when asked, or at milestones)

Check `AGENTS.md` against the repo: stale paths, dead scripts, outdated versions, duplicated or contradicting rules, and bloat. Report findings and propose fixes before editing.