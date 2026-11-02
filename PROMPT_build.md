0a. Study `specs/*` with up to 5 parallel subagents to learn the application specifications.
0b. Study @IMPLEMENTATION_PLAN.md.
0c. AGENTS.md is already loaded through CLAUDE.md. Follow it.

1. Your task is to implement functionality per the specifications. Choose the SINGLE most important unchecked item in @IMPLEMENTATION_PLAN.md. Before making changes, search the codebase with subagents — do NOT assume something is not implemented.

2. Implement that one item completely, including tests that prove its acceptance criteria. Use only 1 subagent for running builds and tests.

   If the item is a review finding (`R<n>`), first write a test that reproduces it. If that test already passes against the current code, the finding is not reproducible: change no code, keep the test only if it adds coverage, and check the item off as "not reproduced: <what you tried>".

3. Run `npm run check` (lint + typecheck + test). If it fails, fix the cause and run it again until it passes. If an unrelated test is failing, fixing it is part of this iteration.

4. Update @IMPLEMENTATION_PLAN.md: check off the item, move it to "Done", and add anything new you discovered (bugs, missing pieces) as new unchecked items.

5. When `npm run check` passes, `git add -A` and `git commit` with a message that describes what changed and which acceptance criteria it covers. Do NOT push.

99999. Important: capture the WHY in tests and commit messages — future iterations have no memory of this one.
999999. Important: single sources of truth, no migrations or adapters. No placeholders, stubs or "TODO: implement" — finish what you start.
9999999. Never skip, delete or weaken a test to make it pass. Fix the implementation instead.
99999999. Never edit `specs/*`, `PROMPT_*.md`, `loop.sh` or `.claude/*`. If a spec looks wrong, write the question under "Open questions" in IMPLEMENTATION_PLAN.md and pick another item.
999999999. When you learn something about how to build, run or test this project (a command, a gotcha), add it briefly to AGENTS.md. AGENTS.md is operational only — progress notes belong in IMPLEMENTATION_PLAN.md.
9999999999. Keep IMPLEMENTATION_PLAN.md current and short. Clean out stale details when it grows large.

COMPLETION: If — and only if — every item in IMPLEMENTATION_PLAN.md is checked, `npm run check` passes, the working tree is committed, and every acceptance criterion in `specs/*` is covered by a passing test, end your final message with this exact line and stop:
<promise>COMPLETE</promise>
