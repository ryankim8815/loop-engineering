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
- Coverage (updated 2026-11-02 after the review fixes): all 20 ACs (AC-API-1…12, AC-UI-1…8) have passing tests, and
  review findings R1–R16 are done (R12 red-before-fix not run, see Done). Only the manual smoke test is blocked (see "Blocked").
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

- [ ] **R18. Keyboard focus is lost to `<body>` after every toggle or inline-edit save** (medium) — Evidence: a
      `node --input-type=module -e` script built a happy-dom `Window`, loaded the `index.html` body, ran `startApp`
      with a stub fetch seeded with T1–T3, focused T2's `.todo-toggle` and called `.click()`, then focused T1's
      `.todo-edit-button`, clicked it, set the editor to `T1x` and dispatched `keydown` Enter →
      `before: true 완료: T2` / `after: active= BODY | old checkbox connected= false | new checked= true` /
      `after edit Enter: active= BODY | title= T1x`. `commitTodos` → `render()` rebuilds every `<li>`
      (`list.replaceChildren`), so the focused control is detached. A keyboard user who toggles item 15 of 20 with
      Space must Tab from the top of the page again before the next action. Esc/cancel goes through the same
      `render()`, but that path was not reproduced separately.
      Expected: spec 02 접근성 ("모든 컨트롤은 키보드만으로 조작 가능"). Fix: in `render()`, remember the focused
      control's item id and class (`todo-toggle`/`todo-edit-button`/`todo-delete`, or the title's edit button after an
      edit ends) and refocus the matching element in the new list if that item is still shown. Add a regression test
      that fails before the fix: focus B's checkbox, toggle it, flush, assert `document.activeElement` is B's new
      `.todo-toggle`; and open/save an edit via 수정 + Enter, assert focus is on that item's `.todo-edit-button`.

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
- **R5 retry shape (review 2026-11-02).** The plan allowed "drop the stale response" or "re-fetch". Chosen: re-fetch
  while the change counter moved during the request. Rejected: dropping the response. Reason: dropping it would
  leave the list without items that were never added this session (a seed of 3 items plus one add would show only
  the add).
- **R6 test shape.** Chosen: export `resolveDbPath` from `src/app.ts` and unit-test it. Rejected: a behavioural
  test that writes to the default `data/` directory during the test run. Reason: that touches the repo's data
  folder. The export is the only change to the public surface.
- **R4 invariant.** `TodoRepository.create` throws if the row is missing right after its own insert. Chosen: fail
  loudly, which surfaces as a 500, rather than return a value the write did not store. Rejected: returning the
  input as a fallback, which is the bug R4 describes.
- **Review scope (review 2026-11-02, R12 pass).** API edge probes via `app.inject()` behaved per spec 01 and are not
  recorded: a deeply nested array/object title (400), `__proto__`/`constructor` keys (400 invalid JSON), an uppercase
  `APPLICATION/JSON` or `charset=latin1` Content-Type (201), `+json`/`jsonx` types (400), a leading BOM (201),
  PUT/OPTIONS/trailing-slash paths (JSON 404), and a JSON body on bulk DELETE (200). A NUL character inside a title
  is accepted and round-trips. Chosen: keep it (spec 01 forbids no code point). Rejected: rejecting control
  characters, a rule the spec does not state.
- **Edit ends when its item leaves the view (R11).** Spec 02 / AC-UI-7 lists Enter, Esc, empty/unchanged and blur as
  the only ways an edit ends. It does not say what happens when a filter change or a delete removes the edited item
  from the list. Chosen: the edit ends with no request, as a blur would (the item is no longer shown or exists).
  Rejected: keeping a hidden edit open in state, because it would have no visible input and no way to finish it
  except by the filter coming back. Spec: 02 (filters, AC-UI-6; inline edit, AC-UI-7).
- **DELETE ignores request bodies (R13, review 2026-11-02).** Spec 01 scopes the Content-Type/JSON-body rules to
  POST/PATCH and gives DELETE no body. Chosen: both DELETE routes ignore any body and Content-Type. Rejected:
  keeping today's 400 (contradicts the POST/PATCH scope and blocks common clients), and accepting only an empty
  JSON body while still rejecting other types (an extra rule the spec does not state). The `completed=true` guard
  is unchanged.
- **Review scope (review 2026-11-02, R13/R14 pass).** Also behaved per spec 01 and not recorded: encoded traversal
  (`/%2e%2e/package.json`, `/..%2fpackage.json`, `/%2e%2e/src/app.ts`) → JSON 404; `/src/app.ts` → 404; a 150-char
  id → 404; `filter=all&filter=all` and `completed=TRUE` → 400; `filter[]=all` and `FILTER=active` are unknown
  params and ignored (200); a GET with an invalid JSON body is ignored (200). Titles render via `textContent` and
  `setAttribute`, so no HTML injection path was found.
- **Resync after a failed list fetch (R15, review 2026-11-02; trigger narrowed 2026-11-02 in the R15 run).** Spec 02
  says an API error must end with the screen matching the server, but item 16 chose not to retry a failed load (no
  loop against a dead server). Chosen: keep that (no automatic retry or timer), and re-fetch the list after the next
  action the server accepts, because that proves the server is back. The R15 plan said "after a failed first load,"
  but the first version tracked "no list loaded yet" and broke the R5 test: a first load that is still pending
  would then also trigger an extra GET. Chosen instead: `listStale` is set when any list fetch fails and cleared when
  one succeeds, so the re-fetch covers a failed first load and a failed resync alike, and never fires during a
  pending load. Rejected: a timed retry loop (adds behaviour the spec does not describe), today's behaviour (the
  banner is cleared while the list is missing server items), and "no list loaded yet" (breaks R5).
- **In-flight delete guard (R16, review 2026-11-02).** Spec 02 does not cover repeated clicks on 삭제. Chosen:
  silently ignore a delete, toggle or edit on an item whose DELETE is still pending (no request, no banner). This
  matches the R8 add guard. Rejected: disabling the buttons (adds visible UI states spec 02 does not describe), and
  sending the request anyway (the server's correct 404 turns into a false error for one user action).
- **Review scope (review 2026-11-02, R16 pass).** Also behaved per spec 01 and not recorded: 416/412 error replies
  carry no static headers (`content-range`/`etag`); `If-None-Match: *` → 304 (a normal cache hit); `HEAD /nope` and
  `/.git/config` → JSON 404; `filter=` → 400; an empty or `multipart/form-data` Content-Type on POST → 400.
  `charset=utf-16le` and `content-encoding: gzip` on a plain JSON body are accepted (201). Chosen: keep that, because
  spec 01 sets no charset or encoding rule.
- **Clear add input only if unchanged (R14, review 2026-11-02).** Spec 02 says a successful add clears the input, but
  it does not say what happens to text typed while the POST is pending. Chosen: clear only when the input still
  holds the submitted text, so the user's new text stays. Rejected: always clearing (loses typed text with no
  notice), and disabling the input during the POST (adds a visible UI state spec 02 does not describe).
- **Review scope (review 2026-11-02, R17 pass).** Also behaved per spec 01 and not recorded: malformed percent-encoding
  inside the query (`?filter=%`, `?filter=%E0%A4%A`, `DELETE ?completed=%`) → 400; a 400k-deep nested array title →
  400; a deeply nested body with `constructor`/`__proto__` keys → 400; `HEAD /api/todos` → 200 with an empty body;
  `GET /api/todos` with a `text/plain` body → 200; `/index.html/` and `/api/todos/%00` → JSON 404; Content-Type
  variants ` application/json`, `application/json;` and an unterminated parameter → 201 (no spec rule on parameters).
  R17's severity is medium, not high: a second click works, and no data is lost.
- **Focus after a re-render (R18, review 2026-11-02).** Spec 02 requires keyboard-only operation but does not say
  where focus goes after an action. Chosen: keep focus on the same control of the same item when it is still shown,
  and on the item's 수정 button when an inline edit ends (Enter/Esc). When the item is gone (delete, filter), focus
  is not moved (a later item can decide). Rejected: leaving focus to the browser (it falls to `<body>`, which forces
  a keyboard user to restart from the top) and moving focus to the add input (unrelated to the action). Severity
  medium, not high: every control stays reachable, but each action costs a full Tab walk.
- **Review scope (review 2026-11-02, R18 pass).** Also behaved per spec 01 and not recorded: GET with
  `content-type: application/json` and no body → 200; PATCH with `application/json` and an empty body → 400; an
  uppercase form of an existing UUID → 404 (the server issues lowercase ids, and an id is matched exactly);
  `filter=active&filter` → 400.
- **Review scope (review 2026-11-02, R19 pass, no new finding).** Also behaved per spec 01 and not recorded:
  `DELETE /api/todos/?completed=true` and `GET /api/todos/` → JSON 404 (no bulk delete through the trailing slash);
  `filter=all%00` → 400; `POST /api/health`, `GET /api`, `POST /` → JSON 404; body `[]` and `{"title":1e400}` → 400.
  Seen but below this review's medium threshold, so not recorded as items: a PATCH that sets `completed` to its
  current value still bumps `updatedAt` (spec 01 "변경 시마다 갱신" does not forbid it, and the UI never sends a
  no-op PATCH), and U+0085 / U+200B titles are accepted because `String.prototype.trim` does not strip them (the
  server and UI apply the same rule, as spec 01 requires). Re-checked by reading `public/app.js` against R17/R18: no
  further UI drift found beyond those two open items.
- **Blur-cancel keeps the rest of the list (R17, review 2026-11-02).** Spec 02 / AC-UI-7 says blur cancels the edit
  with no request and the original title restored. It does not say how the rest of the list is redrawn. Chosen: blur
  swaps only the editor back to the title span, so a control the user is pressing (a mousedown in progress) stays in
  the DOM. Fallback: a full `render()` when the item is no longer shown, because that item's editor has no place to go.
  Rejected: keeping the full re-render and deferring it to `mouseup` (adds timing logic the spec does not describe).
- The three former questions (blur behaviour, unsupported Content-Type, JSON 404 for browser navigations) are
  answered in specs 01/02. See "Current state".

## Done

- **R17. Pressing another list control while an inline edit was open lost that press (review 2026-11-02).**
  `public/app.js` blur now calls `cancelOnBlur(editor)`: it clears `editing` and swaps only the editor for the
  title span (`renderTitle`, split out of `renderItem`). It falls back to `render()` only when the item is no longer
  shown. Tests in `tests/ui.dom.test.ts` (`R17:` ×2, focus moved to B's 삭제 and to B's checkbox while A's editor is
  open): both failed before the fix (B's control detached). Both now pass, and one click sends one DELETE or PATCH.
  Decision: see "Blur-cancel keeps the rest of the list (R17)". `npm run check` is green (226 tests).

- **R15. A successful action after a failed first load left the list out of sync (review 2026-11-02).** `public/app.js`
  sets `listStale` when `loadList()` fails and clears it when a list fetch succeeds. `perform` re-fetches after a
  successful action while `listStale` is set (the banner still clears first). A failed re-fetch keeps the banner and does
  not retry. Test `tests/ui.dom.test.ts` (`R15:`): the first GET fails, the server is seeded with 2 items, and one add
  is made. Before the fix the list showed `['new']` (`1개 남음`). It now shows `['seed1','seed2','new']` (`3개 남음`),
  with no banner. Decision: see "Resync after a failed list fetch (R15)". The narrowed trigger is a deliberate deviation
  from the plan's "not loaded yet" wording. `npm run check` is green (224 tests).

- **R16. Double-clicking 삭제 showed a false error banner (review 2026-11-02).** `public/app.js` keeps a `deleting` set
  of ids whose DELETE is in flight. `removeTodo` ignores an id already in the set, and `setCompleted` and `startEdit`
  ignore it too. The id is removed in a `finally` once the DELETE settles. Tests in `tests/ui.dom.test.ts` (`R16:` ×2,
  DELETE held): a second click on 삭제 sends one DELETE, and a toggle while the DELETE is in flight sends no PATCH.
  Both failed before the fix (a second DELETE, and a PATCH). Both now pass with no banner and an empty list.
  Decision: see "In-flight delete guard (R16)". `npm run check` is green (223 tests).

- **R14. An add that resolved late wiped the title typed meanwhile (review 2026-11-02).** `public/app.js` `submit()`
  records the submitted text and clears the input (and hint) on success only if the input still holds it. Test
  `tests/ui.dom.test.ts` (`R14:`, POST held): text typed while the POST was in flight survives, and a later add sends
  it. It failed before the fix (`''` instead of `'빵 사기'`). The R8 "cleared when nothing was typed" behaviour is
  unchanged. Decision: see "Clear add input only if unchanged (R14)". `npm run check` is green (221 tests).

- **R13. A body-less DELETE with a `Content-Type` header was refused (review 2026-11-02).** `src/app.ts` adds an
  `onRequest` hook that removes `content-type`, `content-length` and `transfer-encoding` from DELETE requests before
  Fastify parses the body, so both DELETE routes ignore any header or body (spec 01 scopes the body rules to
  POST/PATCH). `src/routes/todos.ts` comment updated. Tests in `tests/delete-body.api.test.ts` (4 cases: `application/json`
  with an empty body and `text/plain` with body `x`, for `DELETE /api/todos/:id` and `DELETE /api/todos?completed=true`).
  All 4 failed before the fix (400). Decision: see "DELETE ignores request bodies (R13)". `npm run check` is green
  (220 tests).

- **R12. "완료 항목 삭제" during an in-flight toggle left the list different from the server (review 2026-11-02).**
  `public/app.js` `clearCompleted` now calls `loadList()` after `DELETE ?completed=true` succeeds, instead of
  filtering local state (`todos.filter(!completed)`). The server decides what was deleted, and a late PATCH response
  for a deleted id maps over nothing. Tests in `tests/ui.dom.test.ts` (`R12:` ×2): A active (server deletes it, so
  the list must be empty) and A completed (the clear deletes nothing, so A must stay). Both hold the PATCH, clear,
  release, then compare the rendered titles and counter with the fake server. Decision: re-fetch instead of local
  filtering (no spec choice needed). The alternative, deleting the ids the server reports as deleted, needs a
  response shape the spec does not define.
  **Red-before-fix not run.** The autonomous run's shell was denied the command that would swap in the pre-fix
  `app.js`. By reading the old code, both tests should fail: seed A active keeps A locally (server 0), and seed A
  completed drops A locally (server 1). Verify with the old `clearCompleted` before relying on these tests.
  `npm run check` is green (216 tests, after `npm run format` reflowed one test line).

- **R11. An unrelated re-render discarded an open inline editor (review 2026-11-02).** `public/app.js` keeps the open
  edit in `editing` (`{ id, title, draft, element }`). `render()` rebuilds the editor from the draft and restores
  focus and caret when the editor had focus. The blur handler ignores blur during `render()` (`rendering` flag) and
  from an editor that has already ended. Test `tests/ui.dom.test.ts` (`R11:`): B's PATCH is held while A's editor
  has typed text, then released. It failed before the fix (`no inline editor open`). Decision: an edit whose item
  the filter hides, or that was deleted, ends with no request (see "Edit ends when its item leaves the view (R11)").
  `npm run check` is green (214 tests).
- **R10. Out-of-order PATCH responses left the checkbox opposite to the server (review 2026-11-02).** `public/app.js`
  `mergeUpdated(list, updated)` replaces a todo with a PATCH response only when `updatedAt` is not older than the
  local copy (`Date.parse`). `setCompleted` and the edit `commit` use it. Test `tests/ui.dom.test.ts` (`R10:`): two
  toggles of one item, responses released in reverse order. It failed before the fix (checkbox `true`, server
  `false`). Harness change: `tests/helpers/dom.ts` fake PATCH now bumps `updatedAt` (strictly increasing, per spec
  01) and returns a copy; before, it kept `updatedAt`, so no response could be told apart from a newer copy.
  Decision: the older response is dropped, and the local copy (already newer) is kept. Rejected: rejecting all
  responses while another request is in flight, which would add UI states spec 02 does not describe.
  `npm run check` is green (213 tests).

- **R9. A resync overlapping an add showed the new todo twice (review 2026-11-02).** `public/app.js` `submit()` now
  commits the created todo with `upsertTodo` (replace by id, append only if missing), not `[...todos, created]`.
  Test `tests/ui.dom.test.ts` (`R9:`): the POST is held after the server stores the todo, a failed toggle resyncs
  (its GET includes the todo), then the POST is released. It failed before the fix (3 `<li>`, `['existing', '새 항목',
  '새 항목']`). Decision: none needed (no spec choice). `npm run check` is green (212 tests).

- **R4. A lone-surrogate title differed between POST/PATCH and GET (review 2026-11-02).** `TodoRepository.create` and
  `update` now return the row read back with `get(id)`, not the in-memory object. The stored text (SQLite UTF-8) is
  what every response shows. Test `tests/lone-surrogate.api.test.ts` (POST and PATCH) failed before the fix (the
  created title kept the surrogate and the GET returned the replacement form). Decision: "Lone-surrogate titles
  (R4)" stays as recorded (titles are still accepted). `npm run check` is green (211 tests).
- **R6. An empty `DB_PATH` used a throwaway database (review 2026-11-02).** `src/app.ts` `resolveDbPath(explicit)`:
  explicit `dbPath`, then `DB_PATH`, then `data/todos.db`. An empty or whitespace-only value counts as unset.
  `new DatabaseSync('')` opens a temporary database that is deleted on close, which is why data vanished on restart.
  Unit tests in `tests/db-path.test.ts` (6 cases) failed before the fix (`resolveDbPath is not a function`). This
  is a red for a missing function, not a behavioural red, so the behavioural path is covered by the `resolveDbPath`
  cases for `''`/`'  '`. Decision: see "Empty `DB_PATH` (R6)". `npm run check` is green (209 tests).
- **R8. Double add created duplicate todos (review 2026-11-02).** `public/app.js` `submit()` ignores a call while a
  create is in flight (`adding` flag, reset in `finally`). The flag is set after validation, so an invalid title
  still shows its hint. A failed add releases the flag, so a retry is sent. Tests in `tests/ui.dom.test.ts`
  (`R8:`): a second click and a second Enter each send one POST, with the POST held. Both failed before the fix
  (2 POSTs). The retry-after-failure test passes both before and after, because it guards the flag reset. Decision:
  see "Duplicate add guard (R8)". `npm run check` is green (203 tests). The formatter reflowed one test line.
- **R5. A late list response overwrote items added meanwhile (review 2026-11-02).** `public/app.js` counts accepted
  local changes (`changes`, bumped by `commitTodos` for every add, edit, toggle, delete and clear). `loadList()` is
  shared by the first load and `resync()`. It requests the list again when a change landed during the request, so
  a stale snapshot never replaces newer local state. Test in `tests/ui.dom.test.ts` (`R5:`): the first GET is
  snapshotted before the add and held. The test failed before the fix (`[]` instead of `['우유 사기']`). Decision:
  see "R5 fix shape". `npm run check` is green (200 tests).
- **R7. Range / If-Match headers on static files returned 500 (review 2026-11-02).** `toErrorResponse` maps any other
  non-AppError with a 4xx `statusCode` (416 for Range, 412 for If-Match / If-Unmodified-Since) to 400
  `VALIDATION_ERROR`, after R2's 403/404 rule. These are not logged. Plain errors without `statusCode` stay 500
  (covered by the existing `/__test/boom` test). Tests in `tests/ui.static.test.ts` (5 cases) failed before the fix.
  Decision: see "Status codes for R1–R3" and "Static 412/416 (R7)". `npm run check` is green (199 tests).
- **R3. Oversized bodies and Content-Length mismatches returned 500 (review 2026-11-02).** `src/errors.ts`
  `REQUEST_ERROR_MESSAGES` now includes `FST_ERR_CTP_BODY_TOO_LARGE` and `FST_ERR_CTP_INVALID_CONTENT_LENGTH` →
  400 `VALIDATION_ERROR`. Regression tests in `tests/errors.test.ts` (2.0 MB body; `content-length: 5` with a longer
  payload) failed before the fix. Decision: see "Status codes for R1–R3". `npm run check` is green (194 tests).
- **R2. Traversal-looking static paths returned 500 (review 2026-11-02).** `toErrorResponse` maps a non-AppError with
  `statusCode` 403 or 404 (what `send` throws for `//`, `/..%5c…`, `/index.html%00`) to 404 `NOT_FOUND`. Those
  paths are not logged as server errors. The file contents are still not served. Regression tests in
  `tests/ui.static.test.ts` (8 URLs, including `/api/todos//` and `/index.html%00`) failed before the fix. Decision:
  see "Status codes for R1–R3". `npm run check` is green (192 tests).
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
