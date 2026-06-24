# CHZZK FEED — MVP

치지직 팔로우 채널의 커뮤니티 글을 트위터처럼 모아보는 서비스 MVP입니다.

```
chzzk-feed-mvp/
├── backend/      Node.js + Express 서버 (치지직 공개 API 호출/캐싱)
├── frontend/     순수 HTML/CSS/JS 웹페이지 (사이드바 + 피드 + 광고 영역)
└── extension/    기존 확장프로그램 + 웹사이트 연동 기능 추가
```

## 1. ⚠️ 가장 먼저 해야 할 일: 커뮤니티 게시글 API 찾기

`backend/chzzkApi.js`의 `fetchCommunityPosts()` 함수가 아직 **placeholder URL**입니다.
(샌드박스 환경 네트워크 제약으로 제가 직접 chzzk.naver.com에 접근해서 캡처할 수 없었어요.)

**찾는 방법:**
1. 크롬에서 `chzzk.naver.com` 로그인 후 임의 채널 페이지의 **"커뮤니티" 탭** 클릭
2. 개발자도구(F12) → **Network** 탭 → `Fetch/XHR` 필터
3. 게시글 목록이 담긴 응답을 찾아서 **요청 URL 전체 + 응답 JSON 구조**를 확인
4. `backend/chzzkApi.js`의 `fetchCommunityPosts()` 안 URL과 `mapPost()` 필드 매핑을 실제 구조로 교체

이 URL/구조를 알려주시면 제가 바로 완성해 드릴게요.

## 2. 백엔드 실행

```bash
cd backend
npm install
npm start          # http://localhost:4000
```

- `GET /api/channels/search?keyword=...` — 채널 검색 (로그인 불필요)
- `GET /api/feed?channelIds=id1,id2` — 추가된 채널들의 글을 모아 시간순 정렬해서 반환
- 게시글은 채널별로 10분 캐싱됩니다 (`backend/server.js`의 `POST_CACHE_TTL`)
- 데이터는 `backend/data/*.json`에 파일로 저장됩니다 (DB 설치 불필요, MVP용)

> 참고: 제가 만든 샌드박스 환경에서는 `api.chzzk.naver.com`으로 나가는 네트워크가 막혀있어서
> 실제 응답까지는 테스트하지 못했습니다. 로컬(본인 PC)에서 실행하면 정상적으로 호출될 거예요.

## 3. 프론트엔드 실행

별도 빌드 없이 정적 파일이라, 아무 정적 서버로 띄우면 됩니다. 예:

```bash
cd frontend
npx serve .         # 또는 VSCode Live Server 등
```

`frontend/config.js`에서 `BACKEND_URL`이 백엔드 주소와 맞는지 확인하세요.

## 4. 확장프로그램 연동 설정

1. `chrome://extensions` → 개발자 모드 ON → "압축해제된 확장 프로그램을 로드합니다" → `extension/` 폴더 선택
2. 로드된 확장프로그램의 **ID 복사** (카드에 표시됨)
3. `frontend/config.js`의 `EXTENSION_ID`에 붙여넣기
4. `extension/manifest.json`의 `externally_connectable.matches`에 프론트엔드를 띄운 주소를 추가
   (로컬 테스트라면 `http://localhost:*/*`가 이미 들어있어서 그대로 되고,
   배포 후에는 `https://YOUR-DOMAIN.com/*` 부분을 실제 도메인으로 교체 후 확장프로그램 다시 로드)
5. 치지직에 로그인된 탭을 하나 열어둔 상태에서, 웹페이지의 **"확장프로그램으로 팔로우 가져오기"** 버튼 클릭
   → 기존 `background.js`의 `fetchFollowingsList()`가 그대로 동작해서 팔로우 채널이 사이드바에 일괄 추가됩니다

## 다음 단계 (이후 프리미엄 기능)

- 댓글 보기/달기 (댓글 작성은 사용자 쿠키가 필요해서 확장프로그램 경유 필요)
- "스케줄 피드" 체크 버튼 → AI 분석 → `articleId` 기준 캐시 (분석 결과 재사용)
- 실제 도메인 배포 시: CORS 허용 origin을 `*`에서 본인 도메인으로 좁히기 (`backend/server.js`)
