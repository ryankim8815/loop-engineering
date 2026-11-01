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

## Operational Notes

<!-- Ralph appends short learnings here (commands, gotchas). -->
