# 01. TODO REST API

## 데이터 모델

| 필드 | 타입 | 규칙 |
| --- | --- | --- |
| `id` | string | 서버가 생성하는 UUID v4 |
| `title` | string | 앞뒤 공백 제거 후 1~200자 (유니코드 코드 포인트 기준, 즉 `[...title].length` — 이모지 1개 = 1자). 서버와 UI가 같은 규칙을 쓴다 |
| `completed` | boolean | 기본값 `false` |
| `createdAt` | string | ISO 8601 (UTC), 서버가 생성 |
| `updatedAt` | string | ISO 8601 (UTC), 변경 시마다 갱신 |

목록 정렬: `createdAt` 오름차순(먼저 만든 항목이 위).

## 엔드포인트

기본 경로: `/api/todos`. 요청·응답 본문은 모두 `application/json`.

| 메서드 | 경로 | 설명 | 성공 코드 |
| --- | --- | --- | --- |
| GET | `/api/todos?filter=all\|active\|completed` | 목록 조회 (`filter` 생략 시 `all`) | 200 |
| POST | `/api/todos` | 생성. 본문 `{ "title": string }` | 201 |
| GET | `/api/todos/:id` | 단건 조회 | 200 |
| PATCH | `/api/todos/:id` | 부분 수정. 본문 `{ "title"?: string, "completed"?: boolean }` | 200 |
| DELETE | `/api/todos/:id` | 삭제 | 204 |
| DELETE | `/api/todos?completed=true` | 완료된 항목 일괄 삭제. 응답 `{ "deleted": number }` | 200 |
| GET | `/api/health` | 헬스 체크. 응답 `{ "status": "ok" }` | 200 |

## 요청 처리 규칙

- **본문**: 정의되지 않은 필드가 있으면 400. `PATCH` 본문은 `title`·`completed` 중 **최소 하나**를 포함해야 하며, 빈 본문 `{}`는 400이다.
- **쿼리**: 정의되지 않은 쿼리 파라미터는 **무시**한다(본문과 다름). 정의된 파라미터의 값이 잘못되면 400.
- **일괄 삭제**: `DELETE /api/todos`는 `completed=true`가 있을 때만 동작한다. 쿼리가 없거나 `completed`가 `true`가 아니면 400이고 아무것도 삭제하지 않는다.
- **id**: UUID 형식이 아닌 `:id`도 "존재하지 않는 id"로 보고 404를 반환한다.

## 오류 형식

모든 오류는 다음 형태로 응답합니다.

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "사람이 읽을 수 있는 설명" } }
```

| 상황 | HTTP | `code` |
| --- | --- | --- |
| 본문·쿼리 검증 실패 (빈 제목, 200자 초과, 잘못된 타입, 본문의 알 수 없는 필드, 빈 `PATCH` 본문, 잘못된 `filter`, 일괄 삭제에 `completed=true` 없음, 잘못된 JSON) | 400 | `VALIDATION_ERROR` |
| 존재하지 않는 `id` (UUID 형식이 아닌 경우 포함) | 404 | `NOT_FOUND` |
| 존재하지 않는 경로 (`/api` 밖의 경로 포함) | 404 | `NOT_FOUND` |
| 그 외 서버 오류 | 500 | `INTERNAL_ERROR` (스택 트레이스 노출 금지) |

이 형식은 `/api` 아래뿐 아니라 **서버의 모든 오류 응답**에 적용한다.

## 영속성

- 데이터는 SQLite 파일에 저장되어 **서버 재시작 후에도 유지**된다.
- DB 경로는 환경 변수 `DB_PATH`(기본값 `./data/todos.db`)로 지정한다.
- 테스트는 `:memory:` DB를 사용해 서로 격리된다.

## 수용 기준 (Acceptance Criteria)

- [ ] AC-API-1: `POST`로 생성한 Todo가 `GET /api/todos` 결과에 포함되고 `completed`는 `false`다.
- [ ] AC-API-2: 제목 `"  우유 사기  "`로 생성하면 저장된 제목은 `"우유 사기"`다.
- [ ] AC-API-3: 빈 문자열·공백만 있는 제목·201자 제목은 400 `VALIDATION_ERROR`다.
- [ ] AC-API-4: `PATCH`로 `completed: true`를 보내면 `filter=completed`에는 나타나고 `filter=active`에서는 사라진다.
- [ ] AC-API-5: `PATCH` 후 `updatedAt`은 이전 값보다 크고 `createdAt`은 변하지 않는다.
- [ ] AC-API-6: 존재하지 않는 `id`에 대한 `GET`/`PATCH`/`DELETE`는 404 `NOT_FOUND`다.
- [ ] AC-API-7: `DELETE /api/todos?completed=true`는 완료 항목만 지우고 지운 개수를 반환한다.
- [ ] AC-API-8: 같은 `DB_PATH`로 앱을 다시 만들면 이전에 저장한 Todo가 조회된다.
- [ ] AC-API-9: 빈 본문 `{}`로 `PATCH`하면 400 `VALIDATION_ERROR`이고 Todo(`updatedAt` 포함)는 바뀌지 않는다.
- [ ] AC-API-10: `DELETE /api/todos`(쿼리 없음)와 `?completed=false`는 400 `VALIDATION_ERROR`이고 어떤 Todo도 삭제되지 않는다.
- [ ] AC-API-11: 이모지 200개 제목은 생성되고, 이모지 201개 제목은 400이다.
- [ ] AC-API-12: 존재하지 않는 경로(예: `GET /nope`)는 404와 JSON 오류 형식을 반환한다.
