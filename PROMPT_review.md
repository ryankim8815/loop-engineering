0a. Study `specs/*` with up to 5 parallel subagents to learn the application specifications. Note every rule, not only the acceptance criteria.
0b. Study @IMPLEMENTATION_PLAN.md, including "Done" and "Open questions", so you do not report something that is already known.
0c. Study `src/*`, `public/*` and `tests/*` with up to 5 parallel subagents.
0d. AGENTS.md is already loaded through CLAUDE.md. Follow it.

1. Your task is to REVIEW the implementation, not to change it. Look for defects the existing tests do not catch. Use one subagent per area:
   - Spec compliance beyond the ACs: every rule in `specs/*` (status codes, error envelope, validation limits, query handling), including inputs the specs imply but no test exercises (encoded or `..` paths, repeated query params, huge or deeply nested bodies, unusual Unicode).
   - Security: path traversal in static serving, HTML injection in the UI (titles rendered as HTML), SQL built from strings, stack traces or internals leaking into responses or logs.
   - Test quality: ACs whose test would still pass with a broken implementation, assertions that only mirror the implementation, missing negative cases.
   - Robustness: unhandled promise rejections, resources not closed, state that can drift between the UI and the server.

2. Confirm every finding before you record it. Reproduce it with a command and record the exact command and what it printed. Prefer `node --input-type=module -e "..."` that imports `buildApp` from `./src/app.ts` and calls `app.inject()`, or a single test file run with `npx vitest run`. Do NOT start servers. A suspicion you could not reproduce is not a finding — leave it out.

3. Record confirmed findings in @IMPLEMENTATION_PLAN.md under the prioritized checklist, highest severity first, as unchecked items a build iteration can finish in one go:
   `- [ ] **R<n>. <short title>** (<high|medium|low>) — Evidence: <command> → <observed>. Expected: <spec reference>. Fix: <one line>. Add a regression test that fails before the fix.`
   If the spec does not say what the right behaviour is, add the question under "Open questions" instead of a checklist item. Skip anything already listed in the plan. Record at most 8 findings per iteration.

IMPORTANT: Review only. The ONLY file you may write is IMPLEMENTATION_PLAN.md. Do NOT edit code, tests or AGENTS.md, do NOT install packages and do NOT commit — the build loop fixes what you record.

IMPORTANT: Never edit `specs/*`, `PROMPT_*.md`, `loop.sh`, `stop.sh` or `.claude/*`. Never add an item that needs a human or a running server to finish — the build loop cannot complete it.

COMPLETION: If — and only if — you found NO new confirmed finding in this iteration, end your final message with this exact line and stop:
<promise>COMPLETE</promise>
