# CLAUDE.md

이 문서는 Claude Code가 이 프로젝트에서 작업할 때 참고하는 컨텍스트 문서입니다.
작업을 시작하기 전에 전체를 읽어주세요.

## 프로젝트 개요

**무엇**: 치지직(CHZZK) 팔로우 채널의 커뮤니티 게시글을 트위터 타임라인처럼 모아 보여주는 웹 서비스.
**왜**: 치지직 자체 UI에서는 팔로우한 여러 채널의 커뮤니티 글을 한 곳에서 보기 어려움. 이를 모아주는 도구로 차별화 + 광고 수익화.
**대상**: 여러 스트리머를 팔로우하는 치지직 시청자.

향후 프리미엄 기능으로 댓글 보기/달기, "스케줄 공지" 게시글을 AI로 분석해 구조화된 일정 정보를 캐싱/제공하는 기능을 계획 중 (PLAN.md 참고).

## 아키텍처 — 왜 이렇게 나뉘어 있는지

```
backend/      Express 서버. 치지직의 "공개" API(로그인 불필요)를 직접 호출/캐싱.
frontend/     정적 웹페이지. 사이드바(채널 검색/추가) + 피드 + 광고 영역.
extension/    기존에 개인용으로 쓰던 크롬 확장프로그램 + 웹사이트 연동 기능 추가.
```

핵심 설계 원칙: **공개 데이터는 서버가 직접 가져오고, 개인화된 동작만 확장프로그램을 거친다.**

- 커뮤니티 게시글, 채널 정보, 검색 → 비로그인으로도 보이는 공개 API라서 **백엔드가 직접 호출**한다. 사용자가 확장프로그램을 안 깔아도 피드가 동작해야 함.
- 팔로우 목록 가져오기, (예정) 댓글 작성 → 사용자 본인의 로그인 세션이 필요해서 **확장프로그램을 경유**한다.
  - 확장프로그램의 `background.js`가 사용자가 열어둔 chzzk.naver.com 탭에 `chrome.scripting.executeScript({world:'MAIN'})`로 fetch를 주입해서, 그 탭의 쿠키를 그대로 활용한다 (`getOrOpenChzzkTab`, `fetchViaTab` 함수 참고).
  - 웹페이지 ↔ 확장프로그램 통신은 `manifest.json`의 `externally_connectable` + `chrome.runtime.onMessageExternal`로 직접 연결되어 있다 (별도 content script 불필요).

이 구조를 바꾸기 전에 — 특히 "확장프로그램 없이도 로그인 기능을 웹에서 구현하자"는 식의 제안이 나오면 — 반드시 이유를 검토할 것. 브라우저의 동일 출처 정책/서드파티 쿠키 정책 때문에 순수 웹만으로는 안 됨 (자세한 배경은 PLAN.md의 "왜 확장프로그램이 필요한가" 참고).

## 치지직 API 레퍼런스 (리버스 엔지니어링으로 확인됨)

이 API들은 전부 **비공식**이다. 공식 Open API(`developers.chzzk.naver.com`, OAuth 기반)는 채팅/방송 정보 위주이고 팔로우 목록·커뮤니티 글은 지원하지 않는다. 아래는 실제 devtools 캡처로 확인한 것들:

| 용도 | 메서드/URL | 인증 필요? | 비고 |
|---|---|---|---|
| 채널 검색 | `GET api.chzzk.naver.com/service/v1/search/channels?keyword=&size=` | 불필요 | `backend/chzzkApi.js` |
| 채널 정보 | `GET api.chzzk.naver.com/service/v1/channels/{channelId}` | 불필요 | |
| 팔로우 목록 | `GET api.chzzk.naver.com/service/v1/channels/followings?page=&size=` | **필요** (쿠키) | `extension/background.js`의 `fetchFollowingsList` |
| 채널 VOD 목록 | `GET api.chzzk.naver.com/service/v1/channels/{channelId}/videos?page=&size=` | 불필요 | |
| **커뮤니티 게시글** | `GET apis.naver.com/nng_main/nng_comment_api/v1/type/CHANNEL_POST/id/{channelId}/comments?limit=&offset=&orderType=DESC&pagingType=PAGE` | 불필요(추정) | `backend/chzzkApi.js`. 헤더 `front-client-platform-type: PC`, `front-client-product-type: web`, `Origin/Referer: https://chzzk.naver.com` 필요 |
| 내 댓글 목록 | `GET apis.naver.com/nng_main/nng_comment_api/v1/users/{userIdHash}/list` | 필요 | `extension/background.js`의 `fetchMyComments` |

**게시글 ↔ 댓글 데이터 모델**: 치지직은 채널 게시글을 "그 채널(`objectType: CHANNEL_POST`, `objectId: channelId`)에 달린 루트 댓글"로 모델링한다. `comment.parentCommentId === 0`인 항목이 게시글 본문이고, 그 외는 진짜 댓글/답글이다. 같은 API로 게시글의 댓글도 가져올 수 있을 것으로 추정됨 (`type/COMMENT/id/{commentId}/comments` 류 — 미확인, PLAN.md Phase 2에서 확인 필요).

미확인 사항:
- `attaches` 배열 안 이미지 URL 필드명 (`imageUrl`/`url`/`path` 추정 중, `chzzkApi.js`의 `mapPost` 참고)
- 댓글 작성(POST) 엔드포인트와 필요 파라미터

## 보안 / 처리 주의사항 — 반드시 지킬 것

- **사용자의 NID_AUT/NID_SES 쿠키 값을 코드, 커밋, 로그에 절대 남기지 말 것.** 이 값들은 비밀번호급 민감정보다. 개발 중 캡처한 값이 있다면 `.env`, 커밋 메시지, 주석 어디에도 넣지 않는다.
- `backend/data/*.json` (캐시 파일)은 git에 커밋하지 않는다 (`.gitignore`에 포함됨).
- 비공식 API이므로 **요청 빈도를 보수적으로 유지**한다. `POST_CACHE_TTL`(현재 10분) 같은 캐싱 주기를 함부로 줄이지 말 것. 동시에 너무 많은 채널을 한꺼번에 폴링하는 기능을 추가할 때는 동시 요청 수를 제한(rate limit)할 것.
- 이 프로젝트는 네이버 약관상 회색지대에 있는 비공식 API에 의존한다. 사용자 수가 늘면 네이버 측 대응(차단/약관 변경) 가능성이 항상 있다는 걸 전제로, **특정 엔드포인트가 막혀도 서비스 전체가 죽지 않도록** 항상 try/catch + graceful fallback(빈 배열 등)으로 작성한다 (`fetchCommunityPosts`의 패턴을 따를 것).

## 코딩 컨벤션

- **백엔드**: Node.js ESM(`type: module`), 외부 의존성 최소화 (express, cors 정도). DB 대신 `store.js`의 JSON 파일 저장소 패턴 유지 (트래픽 늘면 Postgres 전환 고려, 그때 `store.js`의 함수 시그니처는 유지).
- **프론트엔드**: 빌드 도구 없는 순수 HTML/CSS/JS. 프레임워크 도입은 별도 논의 후 결정.
- **확장프로그램**: 기존 `background.js`/`hub.js` 스타일(콜백 기반 `chrome.runtime.onMessage`, IIFE 없는 top-level 함수) 그대로 따를 것. 새 메시지 타입 추가 시 기존 `onMessage`/`onMessageExternal` 핸들러 분기 패턴을 그대로 사용.
- 디자인 토큰은 `frontend/style.css` 상단 `:root` 변수 참고 (다크 테마, mint 그린 `#00f0a8` 액센트).

## 실행 방법

```bash
cd backend && npm install && npm start   # http://localhost:4000
cd frontend && npx serve .                # 정적 서버로 띄우기
```

확장프로그램: `chrome://extensions` → 개발자 모드 → `extension/` 폴더 로드 → ID를 `frontend/config.js`의 `EXTENSION_ID`에 입력.

## 현재 상태

MVP 단계. 채널 검색/추가/해제, 피드 조회(커뮤니티 게시글), 확장프로그램으로 팔로우 일괄 추가까지 동작하는 코드는 작성됨. **실제 네트워크 환경에서 아직 end-to-end 테스트 안 됨** (개발 시 사용한 환경이 `api.chzzk.naver.com`/`apis.naver.com`으로 나가는 아웃바운드가 막혀 있었음). 로컬에서 처음 돌릴 때 이 부분을 우선 검증할 것.

다음 작업은 PLAN.md를 참고할 것.
