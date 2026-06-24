# 댓글 조회 기능 설계

**날짜:** 2026-06-22  
**범위:** Phase 2A — 댓글 및 대댓글 조회 (읽기 전용, 비로그인)

---

## 개요

피드 카드의 `💬 N` 버튼을 클릭하면 해당 게시글의 댓글 목록을 카드 하단에 펼쳐 보여준다. 댓글에 대댓글이 있으면 "답글 N개" 버튼으로 추가 로드한다. 댓글/대댓글 모두 20개씩 "더 보기" 버튼으로 페이지네이션.

---

## 확인된 API 정보

```
GET https://apis.naver.com/nng_main/nng_comment_api/v1/type/CHANNEL_COMMENT/id/{parentId}/comments
  ?limit=20&offset=0&orderType=ASC&pagingType=PAGE
```

- `parentId`: 게시글 댓글 → `post.articleId`, 대댓글 → `comment.commentId`
- 인증 불필요 (공개 채널 기준)
- `page.next !== null`이면 다음 페이지 존재
- 스티커: `attaches[].attachType === "STICKER"`, URL은 `attachValue`
- 날짜 형식: 기존 피드와 동일한 `YYYYMMDDHHmmss` (KST)

---

## 변경 파일

| 파일 | 변경 내용 |
|---|---|
| `backend/chzzkApi.js` | `fetchComments(parentId, opts)` 추가 |
| `backend/server.js` | `GET /api/comments` 엔드포인트 추가 |
| `frontend/app.js` | 댓글 토글·렌더·페이지네이션 로직 추가 |
| `frontend/style.css` | 댓글 섹션 스타일 추가 |

변경 없음: `extension/`, `frontend/index.html`, `frontend/config.js`

> **주의:** `buildFeedCard`의 `💬 N` 부분을 `<span>`에서 `<button class="btn-comments" data-article-id="{articleId}">💬 N</button>`으로 교체해야 클릭 핸들러가 동작함.

---

## 백엔드

### `chzzkApi.js` — `fetchComments`

```js
export async function fetchComments(parentId, { limit = 20, offset = 0 } = {})
```

반환값:
```js
{
  comments: [{
    commentId,      // string
    content,        // string
    stickerUrl,     // string | null  (attachType: STICKER)
    imageUrls,      // string[]       (attachType: PHOTO)
    createdAt,      // ISO string (parseChzzkDate 재사용)
    authorName,     // string
    authorImageUrl, // string
    isWriter,       // boolean (user.writer)
    replyCount,     // number
  }],
  hasMore,          // boolean (page.next !== null)
}
```

- `deleted: true` 항목 필터링
- 에러 시 `{ comments: [], hasMore: false }` 반환 (graceful fallback)
- 기존 `COMMENT_HEADERS` + Origin/Referer 재사용

### `server.js` — `/api/comments`

```
GET /api/comments?parentId=&offset=&limit=
```

- `parentId` 없으면 `400` 반환
- 캐싱 없음 (사용자가 직접 열 때만 호출, 실시간성 우선)
- 에러 시 `502` + `{ ok: false, error }`

---

## 프론트엔드

### 댓글 토글

- `💬 N` 버튼 클릭 → 카드 하단 `.feed-card-comments` 섹션 펼침/닫힘
- **첫 펼침 시에만** API 호출, 이후 토글은 DOM show/hide (재호출 없음)
- `feedList` 이벤트 위임으로 처리 (기존 캐러셀 패턴과 동일)

### 댓글 렌더 구조

```
[아바타 26px] 닉네임 · N분 전  [작성자] 뱃지(isWriter일 때)
              댓글 내용 or 스티커 이미지
              [답글 N개 ▼]  ← replyCount > 0일 때만
                [대댓글 목록] ← 답글 버튼 클릭 시 로드, 들여쓰기
```

### 페이지네이션

- `hasMore === true`일 때 댓글 섹션 하단에 "더 보기" 버튼 표시
- 클릭 시 `offset += 20`으로 다음 페이지를 기존 목록에 append
- 대댓글도 동일 패턴 (대댓글 섹션 하단에 별도 "더 보기")

### 이벤트 위임 대상 (feedList)

| 클릭 대상 | 동작 |
|---|---|
| `.feed-card-meta .btn-comments` | 댓글 섹션 토글 |
| `.btn-load-replies` | 대댓글 로드 |
| `.btn-comments-more` | 댓글 다음 페이지 append |
| `.btn-replies-more` | 대댓글 다음 페이지 append |
| `.btn-comments-retry` | 댓글 재시도 |

---

## 에러 처리

| 상황 | 동작 |
|---|---|
| API 호출 실패 | "댓글을 불러오지 못했어요" + 재시도 버튼 |
| 댓글 0개 | "아직 댓글이 없어요" 안내 |
| 대댓글 로드 실패 | 해당 대댓글 섹션만 에러, 나머지 댓글 유지 |

---

## 미결 사항

없음. 구현 준비 완료.
