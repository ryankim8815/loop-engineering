0a. Study `specs/*` with up to 5 parallel subagents to learn the application specifications.
0b. Study @IMPLEMENTATION_PLAN.md (it may be empty) to understand the plan so far.
0c. Study `src/*`, `public/*` and `tests/*` with up to 5 parallel subagents to understand what already exists (these directories may not exist yet).
0d. AGENTS.md is already loaded through CLAUDE.md. Follow it.

1. Compare the existing code against `specs/*`. Use a subagent to analyze the gaps, then create or update @IMPLEMENTATION_PLAN.md as a prioritized checklist of work that is NOT yet done. Think hard. Search for TODOs, minimal implementations, placeholders, skipped tests and inconsistent patterns. Do NOT assume something is missing — confirm with a code search first.

2. Each checklist item must be small enough to finish, test and commit in ONE build iteration, and must reference the acceptance criteria it satisfies (e.g. `AC-API-3`). Put foundational items (project wiring, app factory, persistence) before features that depend on them. Keep completed items in a short "Done" section at the bottom.

IMPORTANT: Plan only. Do NOT implement anything, do NOT install packages and do NOT commit. The only file you may write is IMPLEMENTATION_PLAN.md.

IMPORTANT: Never edit `specs/*`, `PROMPT_*.md`, `loop.sh` or `.claude/*`. If a spec is ambiguous or contradictory, record the question under an "Open questions" heading in IMPLEMENTATION_PLAN.md instead.

ULTIMATE GOAL: a single-user TODO web service (REST API + vanilla web UI on Fastify and node:sqlite) where every acceptance criterion in `specs/*` is covered by passing automated tests.
