# 무한 스크롤 페이지네이션 설계

**날짜:** 2026-06-22  
**범위:** Phase 1 — 피드 페이지네이션 (채널별 독립 offset + 클라이언트 병합)

---

## 개요

치지직 피드에서 여러 채널의 게시글을 최신순으로 통합 표시할 때, 사용자가 스크롤을 내리면 자동으로 다음 페이지를 불러오는 무한 스크롤 기능을 구현한다.

**핵심 원칙:**
- 각 채널의 offset을 독립적으로 관리하고, 클라이언트에서 병합 후 시간순 정렬
- 초기 로드(offset=0)는 기존 캐시 그대로 사용, 추가 로드(offset>0)만 캐시 우회
- 채널 목록이 바뀌면 전체 초기화 후 처음부터 재로드

---

## 변경 파일

| 파일 | 변경 내용 |
|---|---|
| `backend/server.js` | `/api/feed`에 `offsets` 쿼리 파라미터 추가 |
| `frontend/app.js` | 채널별 offset 상태, IntersectionObserver, loadMore() |
| `frontend/index.html` | `#feed-sentinel` div 추가 |
| `frontend/style.css` | `.feed-end`, `.feed-loading-more` 스타일 추가 |

변경 없음: `backend/chzzkApi.js` (이미 `offset` 파라미터 지원)

---

## 백엔드: `/api/feed` 변경

### 요청 형식

```
GET /api/feed?channelIds=a,b,c&offsets=0,10,20
```

- `offsets`: `channelIds`와 같은 순서의 쉼표 구분 정수 배열
- `offsets` 생략 시 전부 0으로 간주 (하위 호환 유지)

### 캐시 정책

- `offset === 0`: 기존 캐시 사용 (10분 TTL)
- `offset > 0`: 캐시 우회, 치지직 API 직접 호출

페이지네이션은 사용자가 직접 트리거하는 동작이라 빈도가 낮음. offset별 캐시 키 분리는 복잡도 대비 효과가 낮아 채택하지 않음.

### `server.js` 변경 요점

```js
// offsets 파싱 (없으면 전부 0)
const offsetList = (req.query.offsets ?? '')
  .split(',').map((s) => parseInt(s, 10) || 0);

const postsPerChannel = await Promise.all(
  channelIds.map((id, i) => getPostsWithCache(id, offsetList[i] ?? 0))
);
```

`getPostsWithCache(channelId, offset)`:
- `offset === 0` → 기존 캐시 로직
- `offset > 0` → 캐시 건너뛰고 `fetchCommunityPosts(channelId, { limit: PAGE_SIZE, offset })` 직접 호출

---

## 프론트엔드: 상태 및 무한 스크롤

### 새로운 상태 변수

```js
const PAGE_SIZE = 10;
let channelOffsets = {};   // { channelId: number }
let exhausted = {};        // { channelId: boolean }
let isLoadingMore = false;
let allPosts = [];         // 누적 게시글 전체
```

### 초기화 조건

`loadFeed()` 진입 시 (채널 추가/제거/전체해제) 위 4개 변수를 모두 초기화.

### sentinel + IntersectionObserver

`index.html`에 추가:
```html
<div id="feed-sentinel"></div>
```
`feed-list` 바로 아래 위치.

observer 동작:
- sentinel이 뷰포트에 들어오고 `isLoadingMore === false`이면 `loadMore()` 호출
- 모든 채널이 exhausted이면 `observer.disconnect()`, sentinel 대신 `.feed-end` 표시

### `loadMore()` 흐름

1. `isLoadingMore = true`
2. exhausted가 아닌 채널만 선별
3. 선별된 채널 ID와 현재 offset으로 `/api/feed` 요청
4. 응답 게시글을 `allPosts`에 push → **새 카드만 `feedList`에 append** (DOM 재생성 없음, 스크롤 위치 보존)
   - 새로 받은 게시글은 항상 기존 목록보다 오래된 글이므로 하단에 append하면 순서 유지
   - 다중 채널 간 페이지 경계에서 미세한 순서 역전이 생길 수 있으나 MVP에서는 허용
5. 반환 게시글 수가 `PAGE_SIZE` 미만인 채널 → `exhausted[channelId] = true`
6. 각 채널의 `channelOffsets[channelId] += PAGE_SIZE`
7. `isLoadingMore = false`

### 에러 처리

| 상황 | 동작 |
|---|---|
| 개별 채널 fetch 실패 | 해당 채널 빈 배열 처리 (기존 try/catch 패턴 유지) |
| 전체 새 게시글 0개 | 토스트 "더 불러오지 못했어요", `isLoadingMore` 해제, observer 유지 |
| 모든 채널 exhausted | `.feed-end` "모든 게시글을 불러왔어요" 표시, observer disconnect |
| 채널 0개 | empty 상태 유지, sentinel/observer 생성 안 함 |

---

## UI 추가 요소

### `index.html`

```html
<!-- feed-list 바로 아래 -->
<div id="feed-sentinel"></div>
```

### `style.css`

```css
.feed-end {
  text-align: center;
  padding: 24px;
  color: var(--text-dim);
  font-size: 12px;
  font-family: var(--font-mono);
}

.feed-loading-more {
  display: flex;
  justify-content: center;
  padding: 16px;
}
```

---

## 미결 사항

없음. 구현 준비 완료.
