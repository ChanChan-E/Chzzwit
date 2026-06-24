# 확장프로그램 재설계 (Chwitter Extension)

**날짜:** 2026-06-22  
**범위:** 기존 VOD Hub 확장프로그램을 chzzk-feed-mvp 전용으로 전면 재설계

---

## 개요

기존 `extension/` 코드(VOD Hub)를 삭제하고, chzzk-feed-mvp 웹앱과의 연동에 필요한 기능만 갖춘 "Chwitter" 확장프로그램으로 교체한다. 핵심 기능: 팔로우 목록 자동 push, 아이콘 클릭 시 웹앱 탭 포커스.

---

## 파일 구조

**삭제:**
- `extension/hub.html`
- `extension/hub.js`
- `extension/hub.css`
- `extension/content.js`

**유지:**
- `extension/icons/` (그대로)

**교체:**
- `extension/manifest.json`
- `extension/background.js`

---

## manifest.json

```json
{
  "manifest_version": 3,
  "name": "Chwitter",
  "version": "1.0.0",
  "description": "치지직 팔로우 채널 피드 — chzzk-feed-mvp 연동",
  "permissions": ["tabs", "scripting", "storage"],
  "host_permissions": [
    "https://chzzk.naver.com/*",
    "https://api.chzzk.naver.com/*"
  ],
  "background": {
    "service_worker": "background.js"
  },
  "externally_connectable": {
    "matches": [
      "http://localhost:*/*",
      "https://YOUR-DOMAIN.com/*"
    ]
  },
  "action": {
    "default_title": "Chwitter 열기"
  },
  "icons": {
    "16": "icons/icon16.png",
    "48": "icons/icon48.png",
    "128": "icons/icon128.png"
  }
}
```

- `action.default_popup` 없음 → 아이콘 클릭은 `chrome.action.onClicked`로 처리
- 도메인 확정 후 `YOUR-DOMAIN.com` 교체

---

## background.js 구조

세 가지 책임:

### ① 아이콘 클릭
```
chrome.action.onClicked → 웹앱 탭(localhost 또는 프로덕션 URL) 검색
  탭 있음 → 포커스
  탭 없음 → 새 탭으로 열기
```

### ② Port 연결 (`chrome.runtime.onConnectExternal`)
웹앱 로드 시 자동 연결. 포트 이름: `'chzzk-feed'`

```
연결 수신
  → 캐시 확인 (chrome.storage.local, TTL 30분)
      신선 → port.postMessage({ type: 'FOLLOWINGS', channels })
      만료 → getOrOpenChzzkTab()
             → fetchFollowingsList()
             → 캐시 저장
             → port.postMessage({ type: 'FOLLOWINGS', channels })
  → 실패 → port.postMessage({ type: 'FOLLOWINGS_ERROR', error })
  → port.onDisconnect: 정리만 (에러 무시)
```

### ③ 헬퍼 함수 (기존 로직 이식)
- `getOrOpenChzzkTab()` — chzzk.naver.com 탭 확보 (있으면 재사용, 없으면 생성 후 로드 대기)
- `fetchViaTab(tabId, url)` — `chrome.scripting.executeScript({ world:'MAIN' })`로 탭에서 fetch 실행, 재시도 2회
- `fetchFollowingsList()` — `api.chzzk.naver.com/service/v1/channels/followings` 페이지네이션 전체 수집

### 포트 메시지 프로토콜
| 방향 | 타입 | 페이로드 |
|---|---|---|
| Extension → Web | `FOLLOWINGS` | `{ channels: Channel[] }` |
| Extension → Web | `FOLLOWINGS_ERROR` | `{ error: string }` |

`PING` 별도 처리 없음 — 포트 연결 성공 자체가 "설치됨" 신호.

---

## frontend/app.js 변경

### 자동 연결 (페이지 로드 시)
```js
// EXTENSION_ID 설정 && chrome.runtime 존재 시
const port = chrome.runtime.connect(EXTENSION_ID, { name: 'chzzk-feed' });
port.onMessage.addListener((msg) => {
  if (msg.type === 'FOLLOWINGS') applyFollowings(msg.channels);
  if (msg.type === 'FOLLOWINGS_ERROR') showToast(msg.error);
});
port.onDisconnect.addListener(() => { /* 버튼 상태 미연결로 복원 */ });
// 연결 성공 → 버튼 "연결됨" 상태 표시
```

### 기존 버튼 (`btn-connect-ext`)
수동 재시도용으로 유지. 클릭 시:
- 포트 없음 → 재연결 시도
- 포트 있음 → 무시 (이미 자동 처리됨)

### `applyFollowings(channels)`
수신한 채널 목록을 `myChannels`에 병합 (이미 추가된 채널은 skip), 피드 갱신.

---

## 에러 처리

| 상황 | 동작 |
|---|---|
| 확장프로그램 미설치 | `connect()` 예외 catch → 조용히 무시, 버튼은 수동 모드 |
| 치지직 미로그인 | `fetchFollowingsList` 빈 배열 → `FOLLOWINGS_ERROR` 전송 |
| chzzk 탭 로딩 타임아웃 | 기존 20초 타임아웃 유지, 에러 메시지 전송 |
| 포트 연결 중 disconnect | `onDisconnect`에서 정리, 재연결은 사용자가 버튼으로 수동 시도 |
