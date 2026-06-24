# PLAN.md

## 배경 — 왜 확장프로그램이 필요한가 (요약)

치지직(네이버)은 공식 OAuth Open API를 제공하지만 팔로우 목록·댓글 작성 같은 개인화 동작을 지원하지 않는다.
브라우저의 동일 출처 정책 + 서드파티 쿠키 제한 때문에, 일반 웹사이트는 사용자가 다른 탭에서 로그인한 치지직 세션에 접근할 수 없다.
그래서 mul.live 같은 선례도 "웹사이트(공개 데이터, 광고/수익화) + 브라우저 확장프로그램(로그인 연동)" 구조를 쓴다. 이 프로젝트도 동일한 구조를 따른다.

공개 데이터(커뮤니티 글, 채널 정보)는 로그인 없이 보이므로 백엔드가 직접 가져온다 — 따라서 핵심 피드 기능은 확장프로그램 없이도 누구나 쓸 수 있다. 확장프로그램은 "팔로우 목록 가져오기"와 "댓글 작성" 같은 개인화 동작에만 필요하다.

---

## Phase 0 — MVP 스캐폴드 (완료)

- [x] 백엔드: 채널 검색/조회/피드 API, JSON 파일 캐싱 (`backend/`)
- [x] 프론트엔드: 사이드바(채널 검색/추가/해제) + 피드 카드 UI + 광고 슬롯 (`frontend/`)
- [x] 확장프로그램: `externally_connectable` + `onMessageExternal`로 웹사이트와 연동, 기존 `fetchFollowingsList` 재사용 (`extension/`)
- [x] 커뮤니티 게시글 API 리버스 엔지니어링 (`apis.naver.com/nng_main/nng_comment_api/v1/type/CHANNEL_POST/...`)
- [ ] **end-to-end 실제 네트워크 테스트** — 아직 안 됨. Phase 1의 0번 작업.

## Phase 1 — MVP 검증 및 보강

1. **실제 환경에서 동작 확인** (최우선)
   - `npm start` 후 `curl "http://localhost:4000/api/feed?channelIds=<실제채널ID>"`로 진짜 게시글이 오는지 확인
   - 안 되면: 헤더 누락/Origin 검증/Rate limit 여부부터 확인 (devtools network 탭과 diff)
2. `attaches` 배열의 이미지 URL 필드명 확정 (devtools에서 한 단계 더 펼쳐서 확인) → `chzzkApi.js`의 `mapPost` 수정
3. 페이지네이션: "더 보기"로 다음 페이지(offset 증가) 로드하는 기능 — 지금은 첫 페이지(10~20개)만 가져옴
4. 채널별 폴링 동시성 제한 (예: 한 번에 5개씩만 fetch, 나머지는 큐)
5. 에러/빈 상태 UI 다듬기, 모바일 레이아웃 점검
6. 배포 전: `backend/server.js`의 CORS를 `*`에서 실제 프론트엔드 도메인으로 좁히기
7. 확장프로그램 `manifest.json`의 `externally_connectable.matches`에서 `YOUR-DOMAIN.com`을 실제 도메인으로 교체

## Phase 2 — 댓글 보기/달기

1. **댓글 조회 API 확인**: 게시글의 `commentId`로 답글 목록을 가져오는 호출을 devtools로 캡처
   (추정: 같은 `nng_comment_api`에서 `parentCommentId`로 필터링하거나 별도 경로일 수 있음 — 게시글 펼쳤을 때 네트워크 탭 확인)
   - 비로그인으로도 보이면 백엔드가 직접 처리 (Phase 1과 동일 원칙)
2. **댓글 작성 API 확인**: 실제로 댓글을 하나 달아보면서 캡처한 POST 요청의 URL/Body/필요 헤더 확인
   - 이건 사용자 인증이 필요할 가능성이 높음 → 확장프로그램에 `POST_COMMENT` 메시지 타입 추가
     (`background.js`의 `fetchViaTab` 패턴을 POST 버전으로 확장: `fetchViaTab`은 GET 전용이라 method/body를 받는 버전 필요)
3. 프론트엔드: 피드 카드에 댓글 펼치기 UI, 댓글 작성 폼 (확장프로그램 미설치 시 "로그인하려면 확장프로그램이 필요해요" 안내)

## Phase 3 — "스케줄 피드" AI 분석 (프리미엄)

목표: 사용자가 게시글을 "스케줄 공지"로 표시하면, AI가 내용을 분석해 구조화된 일정(날짜/시간/방송 제목 등)을 추출하고, 같은 게시글(`articleId` 기준)은 재분석 없이 캐시된 결과를 제공.

1. 데이터 모델 추가 (`backend/store.js`에 새 저장소):
   ```
   schedule_analysis: {
     [articleId]: { analyzedAt, rawContent, schedule: [{date, time, title}], model }
   }
   ```
2. API:
   - `POST /api/posts/:articleId/mark-schedule` — 사용자가 "이건 스케줄 공지예요" 체크
   - `GET /api/posts/:articleId/schedule` — 캐시 있으면 즉시 반환, 없으면 AI 호출 후 저장 후 반환
3. AI 분석 호출은 게시글 본문 텍스트(`content`)를 모델에 보내 구조화된 JSON으로 추출 요청 (날짜 범위 표기가 `{06/22~06/28}`처럼 비정형이라 파싱 규칙을 모델에 맡기는 게 정규식보다 안정적일 것)
4. 캐시 적중률을 높이려면 같은 게시글이 수정되었을 때를 구분할 키가 필요 — `articleId` + `content`의 해시를 같이 저장해서, 내용이 바뀌면 재분석하도록 고려
5. 프리미엄 게이팅(결제/권한 체크)은 이 단계에서는 범위 밖 — 일단 기능만 만들고, 게이팅은 Phase 4 이후 별도 논의

## Phase 4 — 배포/수익화

- 실제 도메인 연결, 호스팅 결정 (백엔드: 가벼운 VM/PaaS, 프론트: 정적 호스팅)
- 확장프로그램 Chrome 웹스토어 등록 (정책: 확장프로그램 자체에는 광고 넣지 않기, `CLAUDE.md` 보안 섹션 재확인)
- 광고 네트워크 연동 (`frontend`의 `.ad-slot` 자리)
- 약관/법적 리스크 재점검 — 비공식 API 의존도가 높아질수록 네이버 측 대응 가능성 커짐. 사용량이 늘면 공식 API로 대체 가능한 부분(채팅 등)은 우선 교체 검토

## 열린 질문 (Claude Code가 작업 중 결정해도 되는 것들)

- 백엔드 캐시를 JSON 파일 → SQLite로 먼저 옮길지 (트래픽 보기 전엔 JSON 파일로 충분)
- 댓글 답글 API가 게시글 API와 동일 패턴인지 별도 패턴인지 (Phase 2에서 캡처해보면 확정)
- AI 분석에 어떤 모델/API를 쓸지 (Claude API 등 — 비용/응답속도 비교 후 결정)
