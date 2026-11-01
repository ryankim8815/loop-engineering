# AGENTS.md — operational guide

Keep this file short and operational (how to build, run and test). Progress belongs in IMPLEMENTATION_PLAN.md.

## Build & Run

- Install: `npm install`
- Run: `npm start` → http://127.0.0.1:3000 (env: `PORT`, `HOST`, `DB_PATH`)
- Dev (auto-reload): `npm run dev`

## Validation (backpressure) — run after every change

- All gates: `npm run check` (= `lint` → `typecheck` → `test`)
- Single gates: `npm run lint` · `npm run typecheck` · `npm test`
- Auto-fix lint/format: `npm run format`
- Single test file: `npx vitest run tests/<name>.test.ts`

## Codebase Patterns

- Node 24 runs `.ts` directly (type stripping). Relative imports end in `.ts`; no `enum`/`namespace`/parameter properties.
- `src/app.ts` exports `buildApp()`; tests use `app.inject()` with `DB_PATH=':memory:'`.
- Persistence uses built-in `node:sqlite` (`DatabaseSync`).
- `tests/toolchain.smoke.test.ts` verifies the environment itself — keep it.

## Permission Limits (headless `dontAsk` mode)

Commands outside the allowlist are denied without a prompt, and a denied commit costs a whole iteration.

- Commit with `git commit -m "$(cat <<'EOF' ... EOF)"` (or a plain `-m "..."`). `git commit -F -` with a heredoc is denied.
- Do not start servers in the background (`&`, `timeout`, `sleep`). Verify HTTP behaviour with `app.inject()` in tests.
- Read several files with the Read tool, not a shell `for` loop (`for` loops are denied).

## Operational Notes

<!-- Ralph appends short learnings here (commands, gotchas). -->
- Fastify ships a built-in `text/plain` body parser. `buildApp` removes it (spec 01 accepts JSON only). Do not re-add it.
- Biome formats test and source files. If `npm run check` fails only on lint, run `npm run format` and re-run.
