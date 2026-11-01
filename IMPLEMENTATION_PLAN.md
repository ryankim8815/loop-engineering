# Implementation Plan

Goal: single-user TODO service (Fastify 5 + `node:sqlite` REST API + vanilla ES-module UI) where every
acceptance criterion in `specs/*` is covered by a passing automated test.

## Current state (gap analysis, 2026-11-02, re-planned after the uncommitted spec edits to 01/02)

Confirmed by reading the repo, not assumed:

- `src/` holds `app.ts`, `server.ts` and `errors.ts` (items 2–3). There is no persistence or todo route yet.
- `public/` does not exist.
- `tests/` holds only `toolchain.smoke.test.ts` (Node ≥ 24, `node:sqlite`, `DB_PATH=':memory:'`). Keep it.
- `package.json` has **no runtime dependencies**. `fastify`, `@fastify/static` and `happy-dom` are not in
  `package.json` or `node_modules`. `start`/`dev` already point at `src/server.ts`.
- Tooling: `vitest.config.ts` uses `environment: 'node'` and sets `DB_PATH=':memory:'`. `tsconfig` is
  strict (`erasableSyntaxOnly`, `verbatimModuleSyntax`, `noUncheckedIndexedAccess`), has no explicit
  `lib` (so DOM types are available to tests), and includes `public/**/*.js` with `checkJs: false`.
  Biome ignores `*.md`, `.claude`, `.ralph`, `data`.
- No TODOs, skips or placeholders exist, because no app code exists.
- Coverage: **0 of 20** ACs (AC-API-1…12, AC-UI-1…8).
- Latest spec edits (uncommitted, human-owned) answer all three former open questions:
  - 01: a non-`application/json` Content-Type on POST/PATCH → **400 `VALIDATION_ERROR`** (not Fastify's 415).
  - 01: a browser opening an unknown path gets the raw **JSON 404**; no HTML error page.
  - 02 / AC-UI-7: inline-edit **blur = cancel**, with no request and the original title restored.

Conventions for every item:

- Put the AC id in the test name, e.g. `it('AC-API-3: rejects 201-char title')`, so
  `grep -rn "AC-" tests/` shows coverage.
- DOM test files start with `// @vitest-environment happy-dom`. Every other test stays on `node`.

## Prioritized checklist

### Foundation

### REST API

### Web UI

### Wrap-up

- [ ] **18. Coverage audit & DoD.** Verified: all 20 spec AC ids (AC-API-1…12, AC-UI-1…8) appear in passing
      tests, and the specs define no others. No `.skip`/`.todo`/`TODO` in `src`, `public`, `tests`. `npm run check`
      is green (180 tests). **Still open:** the manual `npm start` smoke test at http://localhost:3000 (DoD #3).
      AGENTS.md bars background servers in headless mode, so a person has to run it. Do **not** edit `README.md`
      (agent-protected); note any README drift under Open questions instead.

## Open questions


- Inline edit over-length titles (item 15 chose the default): `resolveEdit` does not check the 200-code-point
  limit, so an over-long edit sends a PATCH and gets the server's 400. Spec 02 does not say whether the UI
  should validate first (for example, keep the editor open with a message). Decide when the spec is clarified.

- `npm install` reported 3 moderate npm audit advisories. The audit command was blocked in this iteration, so
  the affected package is unknown. Run `npm audit --omit=dev` (runtime deps) and `npm audit` (all) to triage.
  Only fix them if the fix is non-breaking and `npm run check` stays green.

The three former questions (blur behaviour, unsupported Content-Type, JSON 404 for browser navigations) are
answered in specs 01/02. See "Current state".

## Done

- **17. Styles, accessibility & responsive layout.** `public/styles.css`: completed-item strikethrough now targets
  `.todo-list li.completed .todo-title`. It targeted `label`, which the item never renders, so completed titles were
  never struck through (found by the new test). Selected filter, `:focus-visible`, `border-box`, `max-width` and
  `overflow-wrap: anywhere` are asserted. Tests in `tests/ui.a11y.dom.test.ts` (10 cases, no AC id in spec):
  every control in `index.html` and in a rendered item (plus the open edit input) has a label or `aria-label`, no
  `tabindex="-1"`, the viewport meta exists, and CSS rules match the rendered elements. 360px no-scroll is verified
  only as the CSS properties that guarantee it (happy-dom has no layout). `npm run check` is green (180 tests).

- **16. API error banner + resync.** `public/app.js` `perform(action)` wraps every API call (add, toggle, edit,
  delete, clear, and the initial load). Success clears `#error-banner`. Failure re-renders from local state (which
  reverts an optimistic checkbox or a closed editor), shows `errorMessage` (ApiError → envelope message, anything
  else → a connection message), then `resync()` re-fetches the list. A failed re-fetch shows its own error and does
  not retry. The initial-load failure shows the banner and does not retry. `perform` never rejects, so no
  unhandled rejections remain. The harness gained `failNext(method, outcome)` and `mountApp(seed, beforeStart)`.
  Tests in `tests/ui.dom.test.ts`: AC-UI-8 (9 cases). `npm run check` is green (170 tests).

- **15. Inline edit.** `public/app.js` `startEdit(id)`: double-click on a title, or the `수정` button
  (`aria-label` "수정: …", keyboard path), swaps the title for a focused, prefilled `.todo-edit` input. Enter
  (not during IME composition) → `resolveEdit`: save sends one `PATCH {title}` and re-renders from the server copy.
  Esc, empty/whitespace, unchanged, and blur all cancel with no request (`render()` restores the title). A
  `finished` flag makes the first outcome win, so the blur fired by the editor's own removal does nothing.
  The item is looked up by id at call time, because a blur can re-render the list before a dblclick lands.
  Tests in `tests/ui.dom.test.ts`: AC-UI-7 (10 cases).  `npm run check` is green (161 tests).

- Ralph loop environment, toolchain and smoke test (`tests/toolchain.smoke.test.ts`), commit `6683f7f`.
- Spec clarifications (empty PATCH, query params, bulk-delete guard, non-UUID ids, code-point titles,
  global error envelope, happy-dom), commit `bc74c4b` (human-owned).
- **11. Pure UI state module.** `public/state.js`: `filterTodos`, `countRemaining`, `validateTitle` (trim,
  1–200 code points, mirrors `parseTitle`), `parseFilterFromHash`, `resolveEdit` (empty or unchanged →
  cancel). No DOM access. Tests in `tests/ui.state.test.ts` cover AC-UI-3, including a parity check
  against `src/validation.ts` (200/201 emoji, same results). `npm run check` is green (124 tests).
- **1. Dependencies.** Added runtime `fastify@^5` and `@fastify/static` (resolved to 5.x and 10.x), dev
  `happy-dom`. These are the only additions 03 allows. `npm run check` is green (3 existing tests pass).
- **2. App factory + health.** `src/app.ts` `buildApp({ logger? })` (sync, returns a Fastify instance),
  `GET /api/health` → 200 `{ status: 'ok' }`. `src/server.ts` listens on `PORT`/`HOST` (defaults 3000 /
  127.0.0.1). `tests/health.test.ts` covers the route via `app.inject()`. `dbPath` is **not** added yet:
  item 4 adds it together with the DB wiring. `npm run check` is green (4 tests).
  Not verified: a real `node src/server.ts` run and curl. Left for item 18's manual smoke test.
  Committed in item 3's commit (these files were still untracked before).
- **4. Persistence layer.** `src/db.ts` `openDatabase(path)` (creates parent dir unless `:memory:`, schema
  via `CREATE TABLE IF NOT EXISTS`). `src/todo-repository.ts` `TodoRepository`: `list(filter)`, `get`,
  `create`, `update` (strict `updatedAt` bump via `nextUpdatedAt`), `remove`, `removeCompleted`.
  `buildApp({ dbPath })` decorates `app.todos` and closes the DB in an `onClose` hook; `dbPath` falls back
  to `DB_PATH`, then `data/todos.db`. Tests: `tests/db.test.ts`, `tests/todo-repository.test.ts` (frozen
  clock via `vi.useFakeTimers({ toFake: ['Date'] })`). `npm run check` is green (35 tests).
- **5. Validation module.** `src/validation.ts`: `parseTitle`, `parseCreateBody`, `parsePatchBody`,
  `parseFilter`, `parseBulkDeleteQuery`, `isUuid`. Reuses `TodoFilter` from `todo-repository.ts`. Pure
  functions, so no DB or HTTP needed. Unit tests in `tests/validation.test.ts` (AC-API-2, 3, 9, 10, 11
  at the unit level). The route-level acceptance is covered in items 6–8. `npm run check` is green (67 tests).
- **6. `POST /api/todos` + `GET /api/todos?filter=`.** `src/routes/todos.ts` `registerTodoRoutes(app)`, called
  from `buildApp`. Tests in `tests/todos.api.test.ts`: AC-API-1, AC-API-2, AC-API-3, AC-API-11 (route level),
  plus invalid `filter` → 400, unknown query ignored, unknown/non-string body fields, `text/plain`, no body,
  response shape and list order. `npm run check` is green (81 tests). AC-API-4…10 are still open (items 7–8).
- **3. Central error handling.** `src/errors.ts`: `AppError`, `validationError`, `notFound`,
  `errorEnvelope`, `toErrorResponse` (the single mapping to the envelope). `src/app.ts` wires
  `setErrorHandler` (AppError → own status; Fastify body/media-type/validation errors → 400
  `VALIDATION_ERROR`; everything else → 500 `INTERNAL_ERROR`, logged, never in the body) and
  `setNotFoundHandler` (JSON 404 for all paths). `tests/errors.test.ts` covers AC-API-12 and the error
  paths. Discovery: Fastify ships a built-in `text/plain` parser, so `app.ts` removes it. Without that,
  text/plain bodies returned 200 instead of 400. `npm run check` is green (12 tests).
- **7. `GET` / `PATCH` / `DELETE /api/todos/:id`.** `src/routes/todos.ts`: GET → 200 Todo; PATCH → 200 with the
  updated Todo (body validated before the lookup, so a bad body is 400 even for a missing id); DELETE → 204 with
  an empty body. Missing or non-UUID ids → 404 `NOT_FOUND`. Tests in `tests/todo-by-id.api.test.ts`: AC-API-4,
  5 (incl. back-to-back PATCHes), 6 (UUID and non-UUID), 9, plus PATCH title trim/limit, unknown field,
  `completed: "yes"`, text/plain, and DELETE with no body or Content-Type. `npm run check` is green (94 tests).
- **9. Persistence across app instances.** AC-API-8 covered by `tests/persistence.api.test.ts`: a todo created
  on a `buildApp({ dbPath })` instance is returned by GET after `close()` and a rebuild on a nested, not-yet-existing
  path (parent dirs are created by `openDatabase`). No app code changed. `npm run check` is green (100 tests).
- **8. `DELETE /api/todos?completed=true` (bulk clear).** `src/routes/todos.ts` runs `parseBulkDeleteQuery`
  (the guard, so a bare DELETE can't wipe the list) and then `removeCompleted()` → 200 `{ deleted: n }`.
  Tests in `tests/todos-bulk-delete.api.test.ts`: AC-API-7 (mixed set, and none completed → `{ deleted: 0 }`),
  AC-API-10 (no query, `completed=false`, repeated `completed` → 400, list unchanged). `npm run check` is
  green (99 tests).
- **10. Static serving + HTML skeleton.** `src/app.ts` registers `@fastify/static` (root `public/`, prefix `/`).
  `public/index.html` (`lang="ko"`, viewport, stable ids per the plan) and `public/styles.css` (no JS yet).
  `<script type="module" src="/main.js">` points at a file that arrives in 13a, so a browser currently 404s on it.
  Tests in `tests/ui.static.test.ts`: AC-UI-1 (`/` HTML, `/styles.css` text/css, unknown static path → JSON 404,
  `/api/*` not shadowed). AC-UI-2 stays open for 13a. `npm run check` is green (105 tests).
- **13a. DOM harness + UI controller: render and add.** `public/app.js` `startApp({ document, api })` loads
  the list on start and renders `<li>` items. Enter (not during IME composition) and 추가 both call `submit`,
  which trims the title, sends one POST, appends the item, and clears the input. Invalid input sets the hint
  and sends nothing. `public/main.js` is the only side-effecting bootstrap. `startApp` takes no `window` yet
  (item 14 adds it for `location.hash`). Harness `tests/helpers/dom.ts` (`mountApp`, stateful fake API that
  records requests, `flush`). Tests: AC-UI-4 in `tests/ui.dom.test.ts`, AC-UI-2 in `tests/ui.static.test.ts`.
  `npm run check` is green (144 tests).
- **13b. Toggle, delete, remaining counter.** Each item has a checkbox (`aria-label` "완료: …") and a `삭제`
  button (`aria-label` "삭제: …"). A toggle sends `PATCH {completed}` and waits for the server before
  re-rendering, so local state mirrors what the server accepted. The `completed` class marks done items.
  `#remaining-count` shows `N개 남음` via `countRemaining`. Tests in `tests/ui.dom.test.ts`: AC-UI-5.
  `npm run check` is green (147 tests).
- **14. Filters, hash routing, clear completed.** `startApp` takes `window` (passed from `main.js`). The full list
  stays in memory and is filtered locally (`filterTodos`), so switching filters sends no request. Filter links
  set `location.hash` (click is `preventDefault`ed, and the filter is also applied directly). `hashchange` and the
  initial hash drive the filter. The selected link gets `aria-current="page"` and class `selected`. "완료 항목
  삭제" waits for `DELETE ?completed=true`, then drops completed items. Tests in `tests/ui.dom.test.ts`: AC-UI-6
  (click, initial hash, hashchange) and clear-completed. `npm run check` is green (151 tests).
- **12. API client module.** `public/api.js` `createApi(fetchImpl)`: `list`, `create`, `update`, `remove`,
  `clearCompleted`. `Content-Type` is sent only with a body (DELETE stays bodyless, since Fastify rejects an
  empty JSON body). Non-2xx → `ApiError` (`code`, `message`, `status`) from the spec 01 envelope; a non-JSON or
  envelope-less body falls back to `HTTP_ERROR` with a generic message. 204 is not parsed. Network failures
  reject unchanged. Tests in `tests/ui.api.test.ts` (stub fetch). Supports AC-UI-8 (the banner itself is item 16).
  `npm run check` is green (135 tests).
