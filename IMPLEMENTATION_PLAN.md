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

### Review findings (2026-11-02, review iteration)

Each evidence command is run from the repo root as
`node --input-type=module -e "import { buildApp } from './src/app.ts'; const app = buildApp({ dbPath: ':memory:' }); const r = await app.inject(<ARGS>); console.log(r.statusCode, r.body); await app.close();"`.

- [ ] **R2. Traversal-looking static paths return 500 INTERNAL_ERROR instead of 404** (medium) — Evidence: `<ARGS>` =
      `{ method: 'GET', url: '/..%5cpackage.json' }` (also `/a%5c..%5c..%5cpackage.json`) → `500
      {"error":{"code":"INTERNAL_ERROR",...}}`. An `onError` hook shows the cause: `@fastify/static`/`send` throws a
      plain `Error` with `statusCode 403` ("Forbidden"), which `toErrorResponse` maps to 500 and logs as an unhandled
      server error. The file is not leaked (good), but the status is wrong. Expected: spec 01 — a non-existent path is
      `404 NOT_FOUND`; 500 is only for real server errors. Fix: in `toErrorResponse` (or the error handler), map a
      non-AppError carrying `statusCode` 403/404 from static serving to `404 NOT_FOUND`. Add a regression test that
      fails before the fix (`GET /..%5cpackage.json` → 404 envelope, body does not contain `"name"` from package.json).
      Wider than traversal (re-review 2026-11-02, same `send` 403 cause shown by an `onError` hook): `//api/health`,
      `/api/todos//`, `//`, `/a//b`, `//index.html` and `/index.html%00` all → `500 INTERNAL_ERROR`. Cover at least
      `/api/todos//` and `/index.html%00` in the regression test too.
- [ ] **R3. Oversized bodies and Content-Length mismatches return 500 INTERNAL_ERROR** (medium) — Evidence: `<ARGS>` =
      `{ method: 'POST', url: '/api/todos', headers: { 'content-type': 'application/json' }, payload: JSON.stringify({ title: 'x'.repeat(2000000) }) }`
      → `500 {"error":{"code":"INTERNAL_ERROR",...}}` (cause `FST_ERR_CTP_BODY_TOO_LARGE`, 413); and
      `{ ..., headers: { 'content-type': 'application/json', 'content-length': '5' }, payload: '{"title":"abcdef"}' }`
      → `500` (cause `FST_ERR_CTP_INVALID_CONTENT_LENGTH`, 400). Both are client errors, and both are logged as
      unhandled server errors. Expected: spec 01 — body validation failures (incl. "200자 초과") are `400
      VALIDATION_ERROR`; 500 is only "그 외 서버 오류". Fix: add `FST_ERR_CTP_BODY_TOO_LARGE` and
      `FST_ERR_CTP_INVALID_CONTENT_LENGTH` to `BODY_ERROR_MESSAGES` in `src/errors.ts`. Add regression tests that
      fail before the fix (both cases → 400 `VALIDATION_ERROR`).
- [ ] **R4. A title with a lone surrogate is returned differently by POST and by GET** (low) — Evidence: `<ARGS>` =
      `{ method: 'POST', url: '/api/todos', headers: { 'content-type': 'application/json' }, payload: '{"title":"a\\ud800b"}' }`
      → `201` with title `"a\ud800b"`, but a following `GET /api/todos/<id>` returns `"a�b"` (SQLite stores
      UTF-8, so the lone surrogate becomes U+FFFD). The UI keeps the POST copy in memory, so its state drifts from the
      server until the next reload. Same path applies to PATCH. Expected: spec 01 data model (the stored Todo is the
      one returned) and spec 02 (UI state matches the server). Fix: have `TodoRepository.create`/`update` return the
      row re-read with `get(id)` instead of the in-memory object (see Decisions). Add a regression test that fails
      before the fix (POST body title === GET title for `"a\ud800b"`).
- [ ] **R5. A late list response overwrites items added meanwhile (UI drifts from the server)** (medium) —
      Evidence: `node --input-type=module -e "import { Window } from 'happy-dom'; import { readFileSync } from 'node:fs'; const win = new Window({ url: 'http://127.0.0.1:3000/' }); win.document.write(readFileSync('public/index.html','utf8').replace(/<script[^>]*><\/script>/,'')); const { startApp } = await import('./public/app.js'); let release; const api = { list: () => new Promise(r => { release = () => r([]); }), create: async (title) => ({ id: '11111111-1111-4111-8111-111111111111', title, completed: false, createdAt: 'x', updatedAt: 'x' }) }; const started = startApp({ document: win.document, window: win, api }); win.document.getElementById('new-title').value = '우유 사기'; win.document.getElementById('add-button').click(); await new Promise(r => setTimeout(r, 0)); console.log([...win.document.querySelectorAll('.todo-title')].map(e => e.textContent)); release(); await started; console.log([...win.document.querySelectorAll('.todo-title')].map(e => e.textContent), win.document.getElementById('remaining-count').textContent); await win.happyDOM.close();"`
      → `[ '우유 사기' ]` then `[] 0개 남음`. The item the server created (201) vanishes from the UI because the
      initial `api.list` (a snapshot taken before the POST) resolves later and `startApp` does `todos = loaded`.
      `resync()` in `perform` has the same overwrite when another action succeeds while its GET is in flight.
      Expected: spec 02 "API 오류 … 화면 상태를 서버와 다시 맞춘다" and the UI must reflect what the server accepted
      (spec 02 동작 table: an added item appears at the bottom of the list). Fix: in `public/app.js`, give every
      local mutation a version counter and drop a list response whose request started before the latest mutation
      (or re-fetch instead of assigning). Add a regression DOM test (`failNext`-style deferred `list`) that fails
      before the fix.
- [ ] **R6. An empty `DB_PATH` silently uses a throwaway database** (low) — Evidence:
      `node --input-type=module -e "process.env.DB_PATH = ''; const { buildApp } = await import('./src/app.ts'); const J = { 'content-type': 'application/json' }; let app = buildApp(); await app.inject({ method: 'POST', url: '/api/todos', headers: J, payload: '{\"title\":\"persist me\"}' }); await app.close(); app = buildApp(); const r = await app.inject({ method: 'GET', url: '/api/todos' }); console.log(r.statusCode, r.body); await app.close();"`
      → `200 []`. `options.dbPath ?? process.env.DB_PATH ?? DEFAULT_DB_PATH` keeps `''`, and `new DatabaseSync('')`
      opens SQLite's temporary database, which is deleted on close. Expected: spec 01 영속성 (data survives a
      restart; `DB_PATH` default `./data/todos.db`). Fix: in `buildApp`, treat an empty/whitespace `DB_PATH` (and
      `dbPath`) as unset and fall back to the default (see Decisions). Add a regression test that fails before the
      fix (`DB_PATH=''` set via `vi.stubEnv` in a temp cwd or by asserting the resolved path).
- [ ] **R7. Range / conditional request headers on static files return 500 INTERNAL_ERROR** (medium) — Evidence
      (review 2026-11-02, `onError` hook added to show the cause): `<ARGS>` =
      `{ method: 'GET', url: '/index.html', headers: { range: 'bytes=999999-' } }` (also `/` and
      `/styles.css` with `range: 'bytes=5-1'`) → `500 {"error":{"code":"INTERNAL_ERROR",...}}`, cause
      `RangeNotSatisfiableError` (statusCode 416). `{ ..., headers: { 'if-match': '"nope"' } }` and
      `{ ..., headers: { 'if-unmodified-since': 'Mon, 01 Jan 1990 00:00:00 GMT' } }` → `500`, cause
      `PreconditionFailedError` (412). Any client can make the server log "unhandled request error" with one header.
      Expected: spec 01 오류 형식 — 500 is only "그 외 서버 오류"; these are client errors. Fix: in
      `toErrorResponse`, map a non-AppError whose numeric `statusCode` is 4xx (other than the R2 403/404 case) to
      `400 VALIDATION_ERROR` without logging it as a server error (see Decisions), or register `@fastify/static` with
      `acceptRanges: false` for the Range half. Add a regression test that fails before the fix (both headers → 400
      envelope, not 500). Unrelated cases stay 500 (a thrown plain `Error` without `statusCode`).
- [ ] **R8. Double-clicking 추가 (or Enter twice) creates duplicate todos** (low) — Evidence:
      `node --input-type=module -e "import { Window } from 'happy-dom'; import { readFileSync } from 'node:fs'; const win = new Window({ url: 'http://127.0.0.1:3000/' }); win.document.write(readFileSync('public/index.html','utf8').replace(/<script[^>]*><\/script>/,'')); const { startApp } = await import('./public/app.js'); let n = 0; const posts = []; const api = { list: async () => [], create: async (title) => { posts.push(title); await new Promise(r => setTimeout(r, 5)); n++; return { id: '11111111-1111-4111-8111-11111111111' + n, title, completed: false, createdAt: 'x', updatedAt: 'x' }; } }; await startApp({ document: win.document, window: win, api }); win.document.getElementById('new-title').value = '우유 사기'; win.document.getElementById('add-button').click(); win.document.getElementById('add-button').click(); await new Promise(r => setTimeout(r, 30)); console.log('POSTs:', posts.length, [...win.document.querySelectorAll('.todo-title')].map(e => e.textContent)); await win.happyDOM.close();"`
      → `POSTs: 2 [ '우유 사기', '우유 사기' ]`. `submit()` clears the input only after the POST resolves, so a
      second click/Enter while the first POST is in flight sends the same title again. Expected: spec 02 동작 table
      (one add action → the item is added once and the input is cleared). Fix: in `public/app.js`, ignore `submit()`
      while a create is in flight (an `adding` flag reset in `finally`) — see Decisions. Add a regression DOM test
      (deferred `create`, two clicks → exactly one POST and one item) that fails before the fix.

### REST API

### Web UI

### Wrap-up

- [x] **18. Coverage audit & DoD (automated part).** Re-verified 2026-11-02: all 20 spec AC ids (AC-API-1…12,
      AC-UI-1…8) appear in passing tests (`grep -rhoE "AC-(API|UI)-[0-9]+" specs` yields 20 unique ids), and
      `npm run check` is green (180 tests). No `.skip`/`.todo`/`TODO`/`FIXME` in `src`, `public`, `tests`.
      Working tree was clean before this run. The manual smoke test moved to Blocked below.

## Blocked (needs human)

- **Manual smoke test (DoD #3).** Run `npm start` and open http://127.0.0.1:3000 (the spec default; the older
  note said localhost:3000). Confirm the list loads, add/toggle/edit/delete/filter/clear-completed work, and an
  unknown path returns JSON 404. Why: AGENTS.md forbids background servers in headless `dontAsk` mode, so the
  agent cannot run it. Do **not** edit `README.md` (agent-protected); note any README drift here instead.

## Open questions

(none)

## Decisions (pending human review)

- **Inline edit over-length titles.** Spec 02 is silent on whether the UI validates a PATCH title before sending.
  Chosen: `resolveEdit` still sends the PATCH with no client-side length check. The server returns 400 and item 16's
  error banner shows the envelope message, then resyncs. Rejected: client-side validation that keeps the editor
  open with a message. Reason: that adds UI behaviour the spec does not describe, and the server stays the single
  source of truth for the 200-code-point rule. Spec: 02 (inline edit), 01 (title rule).
- **npm audit (3 moderate advisories).** `npm audit --omit=dev` reports `@fastify/static` → `glob` → `minimatch`
  (GHSA-g3hv-75wg-m249, ReDoS-style DoS). `npm audit` adds no further packages. The only fix offered is
  `npm audit fix --force`, which downgrades `@fastify/static` to 6.12.0 (breaking). Chosen: leave the dependency
  as is. Reason: the fix is breaking, the spec only permits the three declared deps, and the advisory affects
  untrusted glob patterns, which this app never passes to `@fastify/static` (it serves a fixed `public/` root).
  Rejected: forced downgrade. Revisit when `@fastify/static` ships a release that resolves `minimatch` ≥ 11.0.1.
- **Status codes for R1–R3 (review 2026-11-02).** Spec 01's error table only lists 400/404/500. Chosen: malformed URL
  encoding (R1), oversized body and Content-Length mismatch (R3) → `400 VALIDATION_ERROR`; a static path that
  `send` refuses as forbidden (R2) → `404 NOT_FOUND` (spec 01: non-existent path). Rejected: passing through
  Fastify's 413/403, because the spec defines no code for them and lists only 400/404/500.
- **Lone-surrogate titles (R4).** Chosen: keep accepting them (spec 01 counts code points and does not forbid any)
  and return the stored row, so POST/PATCH responses equal what GET returns. Rejected: rejecting non-well-formed
  strings with 400, which would add a validation rule the spec does not state.
- **Empty `DB_PATH` (R6, review 2026-11-02).** Spec 01 gives only the default. Chosen: an empty or whitespace-only
  value counts as unset, so the default `./data/todos.db` is used. Rejected: failing fast at startup with an error,
  which is stricter than the spec implies, and keeping today's behaviour (a temp DB), which breaks persistence.
- **R5 fix shape.** Chosen: discard stale list responses (version counter) in `public/app.js`. Rejected: disabling
  all controls until the first load finishes, which adds UI states spec 02 does not describe.
- **Static 412/416 (R7, review 2026-11-02).** Spec 01 lists only 400/404/500. Chosen: client-caused 4xx from static
  serving (other than R2's 403/404 → 404) → `400 VALIDATION_ERROR`, consistent with the R1/R3 decision. Rejected:
  passing through 412/416 (codes the spec does not define) and keeping 500 (wrongly blames the server).
- **Duplicate add guard (R8, review 2026-11-02).** Spec 02 does not mention in-flight adds. Chosen: silently ignore a
  submit while a POST is pending (no request, no hint). Rejected: disabling the input/button, which adds visible UI
  states spec 02 does not describe; and allowing duplicates, which turns one user action into two todos.
- The three former questions (blur behaviour, unsupported Content-Type, JSON 404 for browser navigations) are
  answered in specs 01/02. See "Current state".

## Done

- **R1. Malformed percent-encoding envelope (review 2026-11-02).** `buildApp` passes Fastify's `frameworkErrors`
  to the same `sendError` used by `setErrorHandler`. `src/errors.ts` maps `FST_ERR_BAD_URL` → 400
  `VALIDATION_ERROR` (the body-error map is renamed `REQUEST_ERROR_MESSAGES`). Regression tests in
  `tests/errors.test.ts` (`/%`, `/%E0%A4%A`, `/api/todos/%`, `/api/todos/%E0%A4%A`) failed before the fix. Decision:
  see "Status codes for R1–R3". `npm run check` is green (184 tests).

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
