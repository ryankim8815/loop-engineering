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

- [ ] **5. Validation module.** `src/validation.ts` (pure functions, throw `AppError` VALIDATION_ERROR):
      - `parseTitle(raw)`: must be a string → trim → 1–200 **code points** (`[...s].length`)
      - `parseCreateBody(body)`: a plain object with exactly `title`; any other key → error
      - `parsePatchBody(body)`: optional `title` / `completed` (boolean); unknown key → error; `{}` → error
      - `parseFilter(query)`: `filter` ∈ `all|active|completed`, default `all`; other query keys ignored
      - `parseBulkDeleteQuery(query)`: `completed` must be exactly `'true'`, else error
      - `isUuid(id)`: used by routes to turn non-UUID ids into 404
      Unit tests (`tests/validation.test.ts`): `''`, `'   '`, 200 chars ok, 201 chars rejected, 200 emoji ok,
      201 emoji rejected, non-string title, unknown field, non-boolean `completed`, `{}` patch, non-object
      body (array, `null`), bad `filter`, unknown query key ignored, bulk-delete query variants.
      _Supports AC-API-2, 3, 9, 10, 11._

### REST API

- [ ] **6. `POST /api/todos` + `GET /api/todos?filter=`.** `src/routes/todos.ts`, registered in
      `buildApp`. Create → 201 + full Todo; list → 200 array in `createdAt` ascending order.
      Tests in `tests/todos.api.test.ts`:
      - AC-API-1: a created todo appears in the list with `completed: false`
      - AC-API-2: `"  우유 사기  "` is stored as `"우유 사기"`
      - AC-API-3: `""`, `"   "`, 201-char title → 400 `VALIDATION_ERROR`
      - AC-API-11: 200 emoji (e.g. `'😀'.repeat(200)`) → 201; 201 emoji → 400
      - invalid `filter` → 400; an unknown query param (e.g. `?foo=1`) is ignored → 200
      - unknown body field → 400; non-string title → 400; `text/plain` body on the real route → 400
      - response shape: UUID v4 `id`, ISO `createdAt`/`updatedAt`; list order preserved

- [ ] **7. `GET` / `PATCH` / `DELETE /api/todos/:id`.** GET → 200; PATCH → 200 with the updated Todo;
      DELETE → 204 with an empty body. Tests:
      - AC-API-4: after `PATCH {completed:true}` the todo is in `filter=completed` and not in `filter=active`
      - AC-API-5: after PATCH, `updatedAt` > previous and `createdAt` is unchanged (also two PATCHes back-to-back)
      - AC-API-6: GET/PATCH/DELETE on a non-existent UUID → 404 `NOT_FOUND`; a non-UUID id (`/api/todos/abc`)
        → 404 too
      - AC-API-9: `PATCH {}` → 400 `VALIDATION_ERROR`, and a following GET shows title, completed and
        `updatedAt` unchanged
      - a PATCH title is trimmed and validated like POST; unknown PATCH field → 400; `completed: "yes"` → 400;
        `text/plain` PATCH → 400
      - DELETE with no body and no Content-Type → 204 (the shape the UI client will send)

- [ ] **8. `DELETE /api/todos?completed=true` (bulk clear).** → `200 { "deleted": n }`. Tests:
      - AC-API-7: a mix of completed/active → only completed removed and `deleted` matches; none completed → `{ deleted: 0 }`
      - AC-API-10: `DELETE /api/todos` (no query) and `?completed=false` → 400 `VALIDATION_ERROR`, and the
        list is unchanged afterwards

- [ ] **9. Persistence across app instances.** AC-API-8: `buildApp({ dbPath: <tmp>/nested/todos.db })`,
      create a todo, `await app.close()`, build a new app on the same path, and GET returns the todo. Use
      `fs.mkdtempSync(path.join(os.tmpdir(), ...))` and remove it in `afterEach`. Also assert that the
      missing parent directory is created automatically.

### Web UI

- [ ] **10. Static serving + HTML skeleton.** Register `@fastify/static` (root `public/`, `index.html` at
      `/`) so it doesn't shadow `/api/*` and unknown paths still reach the JSON 404 handler from item 3
      (re-run the AC-API-12 tests, including the `Accept: text/html` case). Create `public/index.html`
      (`lang="ko"`, viewport meta) and `public/styles.css`, with stable ids:
      - `#new-title` input with `<label>`, `#add-button` "추가", `#new-title-hint` (aria-live) near the input
      - `#todo-list` `<ul>`
      - footer: `#remaining-count`, filter links `a[href="#/"]`, `a[href="#/active"]`, `a[href="#/completed"]`,
        `#clear-completed` "완료 항목 삭제"
      - `#error-banner` with `role="alert"` (hidden when empty), at the top of the page
      - `<script type="module" src="/main.js">` and `<link rel="stylesheet" href="/styles.css">`
      Tests (`tests/ui.static.test.ts`, node env, `app.inject()`):
      - AC-UI-1: `GET /` → 200, `text/html`, contains the input, list and filter elements
      - `GET /styles.css` → `text/css`; `GET /missing.js` → JSON 404 envelope
      _AC-UI-2 is asserted in item 13a, once real modules exist. No placeholder JS here._

- [ ] **11. Pure UI state module.** `public/state.js` (ES module, no DOM access, JSDoc types):
      `filterTodos(todos, filter)`, `countRemaining(todos)`, `validateTitle(raw)` →
      `{ ok: true, value } | { ok: false, message }` (trim, 1–200 code points, the same rule as the server),
      `parseFilterFromHash(hash)` (`#/active` → `active`, `#/completed` → `completed`, else `all`),
      `resolveEdit(original, raw)` → `{ action: 'save', value } | { action: 'cancel' }` (empty/whitespace
      or unchanged → cancel). Tests in `tests/ui.state.test.ts` import `../public/state.js`.
      - AC-UI-3 (incl. 200/201-emoji parity with AC-API-11)

- [ ] **12. API client module.** `public/api.js`: `createApi(fetchImpl = globalThis.fetch)` returning
      `list(filter)`, `create(title)`, `update(id, patch)`, `remove(id)`, `clearCompleted()`.
      - Send `Content-Type: application/json` **only** when there is a body (POST/PATCH). DELETE
        requests must not send it, or Fastify rejects the empty JSON body with 400.
      - Non-2xx → throw `ApiError` carrying `code`/`message` from the envelope (fallback message when the
        body isn't JSON). Handle 204 without parsing.
      Unit tests with a stub `fetch` (`tests/ui.api.test.ts`) cover the URL, method, headers (including
      no Content-Type on DELETE), body and error parsing. _Supports 02 "API 오류" / AC-UI-8._

- [ ] **13a. DOM harness + UI controller: render and add.** `public/app.js` exports
      `startApp({ document, window, api })` (no side effects on import); `public/main.js` is a short
      bootstrap that calls it with the real globals and `createApi()`. Render from server state using `state.js`.
      Test harness `tests/helpers/dom.ts`: load the `<body>` of `public/index.html` into the happy-dom
      document, install a stateful fake `fetch` (in-memory todos, records every request), call `startApp`,
      and expose a `flush()` helper that awaits pending promises.
      Tests (`tests/ui.dom.test.ts`, `// @vitest-environment happy-dom`):
      - AC-UI-4: type + Enter → one `POST` with the trimmed title, the new item is the last `<li>`, the
        input is cleared; empty/whitespace + Enter → no request and the hint text is visible. Clicking
        "추가" behaves the same.
      Also in `tests/ui.static.test.ts`:
      - AC-UI-2: `GET /main.js`, `/app.js`, `/state.js`, `/api.js` → `text/javascript` or `application/javascript`

- [ ] **13b. Toggle, delete, remaining counter.** Each item has a labelled checkbox and an `aria-label`ed
      delete button; completed items get a `completed` class (strikethrough in CSS); `#remaining-count`
      is computed with `countRemaining`. Tests (DOM):
      - AC-UI-5: toggling the checkbox → `PATCH {completed}` and the `completed` class flips; the delete
        button → `DELETE` and the `<li>` disappears; `#remaining-count` updates after each.

- [ ] **14. Filters, hash routing, clear completed.** Filter clicks set `location.hash`; `hashchange`
      and the initial hash drive the active filter; the selected link gets `aria-current="page"` (+ a CSS
      class). "완료 항목 삭제" calls the bulk endpoint and re-renders.
      Tests (DOM):
      - AC-UI-6: clicking the active filter → hash `#/active` and only active items shown; setting
        `window.location.hash = '#/completed'` before `startApp` → only completed items from the first render
      - clear-completed sends `DELETE /api/todos?completed=true` and removes completed items

- [ ] **15. Inline edit.** Double-click a title → an edit `<input>` (focused, prefilled). Enter →
      `PATCH {title}` and the new title is shown. Esc, Enter with an empty/whitespace value, and **blur**
      (spec 02) all cancel: no request, original title restored (use `resolveEdit`). Make sure the
      Enter/Esc paths don't also fire a second action from the blur that follows the editor's removal.
      Keyboard access: an `aria-label`ed edit button (or Enter/F2 on a focusable title) opens the same editor.
      Tests (DOM): AC-UI-7. Double-click shows the editor; Enter sends one PATCH; Esc, an empty value and
      blur each send nothing and restore the original title.

- [ ] **16. API error banner + resync.** Every API call goes through one handler. On an `ApiError` or a
      network error, it shows the message in `#error-banner` (`role="alert"`, unhidden), then re-fetches
      the list and re-renders. The banner clears on the next successful action.
      Tests (DOM): AC-UI-8. Make the fake `fetch` return a 400/500 envelope for one PATCH (or POST). The
      banner text must equal the envelope message, a follow-up `GET /api/todos` must have been issued, and
      the DOM must match the fake server's state.

- [ ] **17. Styles, accessibility & responsive layout.** `public/styles.css`: strikethrough for
      `.completed`, a visible selected filter, a visible `:focus-visible`, `box-sizing: border-box`,
      `max-width: 100%`, `overflow-wrap: anywhere` for long titles so 360px has no horizontal scroll.
      Test (DOM suite): every `<input>`/`<button>` in `index.html` **and** in a rendered item (including the
      edit input) has a `<label>` or `aria-label`; all controls are native focusable elements (no
      `tabindex="-1"`); the viewport meta is present. _Spec 02 접근성·반응형._

### Wrap-up

- [ ] **18. Coverage audit & DoD.** `grep -rn "AC-API-\|AC-UI-" tests/` shows all 20 ids (AC-API-1…12,
      AC-UI-1…8) in passing tests. No `.skip`/`.todo`/`TODO` in `src`, `public`, `tests`. `npm run check`
      is green. Manual `npm start` smoke test at http://localhost:3000 (DoD #3). Do **not** edit `README.md`
      (agent-protected); note any README drift under Open questions instead.

## Open questions

- `npm install` reported 3 moderate npm audit advisories. The audit command was blocked in this iteration, so
  the affected package is unknown. Run `npm audit --omit=dev` (runtime deps) and `npm audit` (all) to triage.
  Only fix them if the fix is non-breaking and `npm run check` stays green.

The three former questions (blur behaviour, unsupported Content-Type, JSON 404 for browser navigations) are
answered in specs 01/02. See "Current state".

## Done

- Ralph loop environment, toolchain and smoke test (`tests/toolchain.smoke.test.ts`), commit `6683f7f`.
- Spec clarifications (empty PATCH, query params, bulk-delete guard, non-UUID ids, code-point titles,
  global error envelope, happy-dom), commit `bc74c4b` (human-owned).
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
- **3. Central error handling.** `src/errors.ts`: `AppError`, `validationError`, `notFound`,
  `errorEnvelope`, `toErrorResponse` (the single mapping to the envelope). `src/app.ts` wires
  `setErrorHandler` (AppError → own status; Fastify body/media-type/validation errors → 400
  `VALIDATION_ERROR`; everything else → 500 `INTERNAL_ERROR`, logged, never in the body) and
  `setNotFoundHandler` (JSON 404 for all paths). `tests/errors.test.ts` covers AC-API-12 and the error
  paths. Discovery: Fastify ships a built-in `text/plain` parser, so `app.ts` removes it. Without that,
  text/plain bodies returned 200 instead of 400. `npm run check` is green (12 tests).
