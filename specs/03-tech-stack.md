# 03. 기술 스택 · 품질 기준

## 고정된 스택 (변경 금지)

| 영역 | 선택 | 비고 |
| --- | --- | --- |
| 런타임 | Node.js 24+ | 내장 TypeScript 타입 제거(type stripping)로 `.ts`를 직접 실행 |
| 언어 | TypeScript (strict) | 빌드 산출물 없음. `tsc`는 타입 검사(`--noEmit`)에만 사용 |
| HTTP 서버 | Fastify 5 | `@fastify/static`으로 `public/` 제공 |
| 저장소 | `node:sqlite` (Node 내장) | 네이티브 빌드가 필요한 DB 드라이버 금지 |
| 테스트 | Vitest | API는 `app.inject()`로 테스트(실제 포트 바인딩 불필요) |
| Lint/Format | Biome | `biome.json` 설정을 따른다 |

새 런타임 의존성은 위 표에 있는 패키지(`fastify`, `@fastify/static`)만 허용한다.
그 밖의 패키지가 꼭 필요하면 구현하지 말고 `IMPLEMENTATION_PLAN.md`에 사유를 남긴다.

## 코드 구조

```
src/
  app.ts        # buildApp(options): FastifyInstance — 테스트에서 재사용하는 앱 팩토리
  server.ts     # 진입점: buildApp() 후 listen (PORT 기본 3000, HOST 기본 127.0.0.1)
  ...           # 라우트·저장소·검증 등은 자유롭게 분리
public/
  index.html
  *.js / *.css
tests/
  *.test.ts
```

## TypeScript 규칙 (Node type stripping 제약)

- 상대 경로 import에는 `.ts` 확장자를 붙인다. 예: `import { buildApp } from './app.ts'`
- 타입 제거만으로 실행 가능한 문법만 사용한다: `enum`, `namespace`, 생성자 parameter property 금지
- 타입만 가져올 때는 `import type`을 사용한다.

## 품질 기준

- `npm run check`가 통과하지 않은 상태로 커밋하지 않는다.
- 테스트는 실제 동작을 검증한다. 테스트를 건너뛰거나(`skip`/`todo`) 기대값을 구현에 맞춰 약화시키지 않는다.
- 플레이스홀더·스텁·"TODO: implement" 구현 금지. 기능은 끝까지 완성한다.
- 오류 응답에 스택 트레이스나 내부 경로를 노출하지 않는다.
