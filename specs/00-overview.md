# 00. 제품 개요 — Ralph TODO

> 이 문서는 **사람이 소유**합니다. Ralph(에이전트)는 읽기만 하며 수정하지 않습니다.
> 요구사항이 바뀌면 사람이 이 디렉터리(`specs/`)를 고친 뒤 `./loop.sh plan`을 다시 실행합니다.

## 비전

단일 사용자가 브라우저에서 할 일을 추가·완료·수정·삭제할 수 있는 가볍고 빠른 TODO 웹 서비스.

## 범위 (In scope)

| 영역 | 문서 |
| --- | --- |
| REST API와 데이터 모델 | [01-todo-api.md](01-todo-api.md) |
| 웹 UI | [02-web-ui.md](02-web-ui.md) |
| 기술 스택·품질 기준 | [03-tech-stack.md](03-tech-stack.md) |

## 범위 밖 (Out of scope)

- 회원가입·로그인·멀티 유저
- 실시간 동기화(WebSocket 등), 오프라인 모드
- 첨부 파일, 하위 작업, 태그, 마감일 알림
- 배포 파이프라인, 컨테이너 이미지

## 용어

| 용어 | 의미 |
| --- | --- |
| Todo | 제목과 완료 여부를 가진 할 일 한 건 |
| 필터 | `all` / `active`(미완료) / `completed`(완료) 중 하나 |

## 완료 정의 (Definition of Done)

1. `01`~`03` 문서의 모든 **수용 기준(Acceptance Criteria)** 이 자동화된 테스트로 검증된다.
2. `npm run check`(lint + typecheck + test)가 통과한다.
3. `npm start` 후 `http://localhost:3000`에서 UI로 전체 흐름을 사용할 수 있다.
