# Chwitter Extension Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 기존 VOD Hub 확장프로그램을 삭제하고, chzzk-feed-mvp 웹앱 전용 "Chwitter" 확장프로그램으로 재작성한다. 핵심: 웹앱 로드 시 팔로우 목록을 포트로 자동 push.

**Architecture:** 웹앱이 `chrome.runtime.connect`로 포트를 열면, `background.js`가 `onConnectExternal`에서 감지 → `fetchViaTab`으로 팔로우 목록을 수집 → 포트로 push. 캐시(30분 TTL)가 신선하면 즉시 반환. 아이콘 클릭은 웹앱 탭 포커스로만 사용.

**Tech Stack:** Chrome Extension Manifest V3, Service Worker, chrome.scripting, chrome.storage.local, chrome.runtime ports

---

### Task 1: 기존 파일 정리

**Files:**
- Delete: `extension/hub.html`
- Delete: `extension/hub.js`
- Delete: `extension/hub.css`
- Delete: `extension/content.js`

- [ ] **Step 1: 구 파일 삭제**

```bash
rm extension/hub.html extension/hub.js extension/hub.css extension/content.js
```

- [ ] **Step 2: 삭제 확인**

```bash
ls extension/
```

Expected output: `background.js  icons/  manifest.json` (hub* 파일 없음)

---

### Task 2: manifest.json 교체

**Files:**
- Modify: `extension/manifest.json`

- [ ] **Step 1: manifest.json 전체 교체**

`extension/manifest.json`:
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

- [ ] **Step 2: chrome://extensions 에서 확장프로그램 다시 로드**

`chrome://extensions` → Chwitter → 새로고침 버튼 클릭. 오류 없이 로드되면 성공.

---

### Task 3: background.js 전면 교체

**Files:**
- Modify: `extension/background.js`

- [ ] **Step 1: background.js 전체 교체**

`extension/background.js`:
```js
const CHZZK_ORIGIN   = 'https://chzzk.naver.com';
const API_BASE       = 'https://api.chzzk.naver.com/service/v1';
const FOLLOWINGS_KEY = 'chwitter_followings';
const FOLLOWINGS_TTL = 30 * 60 * 1000; // 30분
const WEB_APP_URL    = 'http://localhost:5500'; // 프로덕션 배포 시 교체

// ── 아이콘 클릭: 웹앱 탭 포커스 or 열기 ──
chrome.action.onClicked.addListener(() => {
  chrome.tabs.query({ url: 'http://localhost:*/*' }, (tabs) => {
    if (tabs.length > 0) {
      chrome.tabs.update(tabs[0].id, { active: true });
      chrome.windows.update(tabs[0].windowId, { focused: true });
    } else {
      chrome.tabs.create({ url: WEB_APP_URL });
    }
  });
});

// ── 포트 연결: 웹앱 로드 시 팔로우 목록 자동 push ──
chrome.runtime.onConnectExternal.addListener((port) => {
  if (port.name !== 'chzzk-feed') return;

  let disconnected = false;
  port.onDisconnect.addListener(() => { disconnected = true; });

  (async () => {
    try {
      const cached = await getFollowingsCache();
      if (cached) {
        if (!disconnected) port.postMessage({ type: 'FOLLOWINGS', channels: cached });
        return;
      }
      const channels = await fetchFollowingsList();
      await setFollowingsCache(channels);
      if (!disconnected) port.postMessage({ type: 'FOLLOWINGS', channels });
    } catch (err) {
      if (!disconnected) port.postMessage({ type: 'FOLLOWINGS_ERROR', error: err.message });
    }
  })();
});

// ── 캐시 읽기 ──
async function getFollowingsCache() {
  return new Promise((resolve) => {
    chrome.storage.local.get(FOLLOWINGS_KEY, (r) => {
      const c = r[FOLLOWINGS_KEY];
      if (!c || Date.now() - c.ts > FOLLOWINGS_TTL) { resolve(null); return; }
      resolve(c.channels);
    });
  });
}

// ── 캐시 쓰기 ──
async function setFollowingsCache(channels) {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [FOLLOWINGS_KEY]: { channels, ts: Date.now() } }, resolve);
  });
}

// ── chzzk.naver.com 탭 확보 ──
async function getOrOpenChzzkTab() {
  const tabs = await chrome.tabs.query({ url: `${CHZZK_ORIGIN}/*` });
  if (tabs.length > 0) return tabs[0];

  const tab = await chrome.tabs.create({ url: CHZZK_ORIGIN, active: false });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(onUpdated);
      reject(new Error('치지직 탭 로딩 타임아웃 (20초). 치지직에 로그인 후 다시 시도해주세요.'));
    }, 20000);
    function onUpdated(tabId, info) {
      if (tabId === tab.id && info.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(onUpdated);
        clearTimeout(timer);
        resolve();
      }
    }
    chrome.tabs.onUpdated.addListener(onUpdated);
  });
  await sleep(1500);
  return tab;
}

// ── 탭의 fetch 컨텍스트에서 API 호출 (쿠키 자동 포함) ──
async function fetchViaTab(tabId, url, retries = 2) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId },
        world: 'MAIN',
        func: async (fetchUrl) => {
          try {
            const r = await fetch(fetchUrl, { credentials: 'include' });
            const text = await r.text();
            let data;
            try { data = JSON.parse(text); } catch { data = text; }
            if (!r.ok) return { ok: false, error: `HTTP ${r.status}`, body: typeof data === 'string' ? data.slice(0, 200) : JSON.stringify(data).slice(0, 200) };
            return { ok: true, data };
          } catch (e) {
            return { ok: false, error: e.message };
          }
        },
        args: [url],
      });
      const result = results?.[0]?.result;
      if (!result) throw new Error('스크립트 결과 없음 (탭 접근 실패)');
      if (!result.ok) throw new Error(result.error + (result.body ? ` → ${result.body}` : ''));
      return result.data;
    } catch (e) {
      const isPerm = e.message?.includes('Cannot access contents') || e.message?.includes('manifest must request');
      if (isPerm && attempt < retries) { await sleep(1000 * (attempt + 1)); continue; }
      throw new Error(`스크립트 실행 실패: ${e.message}`);
    }
  }
}

// ── 팔로우 목록 전체 페이지 수집 ──
async function fetchFollowingsList() {
  const tab = await getOrOpenChzzkTab();
  const channels = [];
  let page = 0;
  while (true) {
    const url = `${API_BASE}/channels/followings?page=${page}&size=50`;
    const res = await fetchViaTab(tab.id, url);
    const list = res?.content?.followingList ?? res?.content?.data ?? res?.content?.follows ?? [];
    list.forEach((item) => {
      const ch = item.channel ?? item;
      if (ch?.channelId) {
        channels.push({
          channelId:       ch.channelId,
          channelName:     ch.channelName     ?? '',
          channelImageUrl: ch.channelImageUrl ?? '',
        });
      }
    });
    const totalPage = res?.content?.totalPage ?? 1;
    if (page + 1 >= totalPage || list.length < 50) break;
    page++;
  }
  return channels;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
```

- [ ] **Step 2: chrome://extensions 에서 확장프로그램 다시 로드**

`chrome://extensions` → Chwitter → 새로고침. Service Worker 상태가 "활성" 또는 "유휴"이면 성공. 오류 있으면 "서비스 워커 검사" 클릭해서 콘솔 확인.

---

### Task 4: frontend/app.js — 포트 자동 연결 추가

**Files:**
- Modify: `frontend/app.js`

- [ ] **Step 1: 포트 상태 변수 및 `connectExtension` 함수 추가**

`els` 선언 블록 바로 아래(line 18 이후)에 추가:
```js
// ── 확장프로그램 포트 상태 ──
let extPort = null;
```

- [ ] **Step 2: `connectExtension` 함수 추가**

`showToast` 함수 위에 삽입:
```js
function connectExtension() {
  if (!window.EXTENSION_ID || window.EXTENSION_ID === 'YOUR_EXTENSION_ID_HERE') return;
  if (!window.chrome?.runtime?.connect) return;
  if (extPort) return;
  try {
    extPort = chrome.runtime.connect(window.EXTENSION_ID, { name: 'chzzk-feed' });
    els.btnConnectExt.classList.add('connected');
    extPort.onMessage.addListener((msg) => {
      if (msg.type === 'FOLLOWINGS') applyFollowings(msg.channels);
      if (msg.type === 'FOLLOWINGS_ERROR') showToast(`팔로우 가져오기 실패: ${msg.error}`);
    });
    extPort.onDisconnect.addListener(() => {
      extPort = null;
      els.btnConnectExt.classList.remove('connected');
    });
  } catch {
    // 확장프로그램 미설치 시 조용히 무시
  }
}

function applyFollowings(channels) {
  let addedCount = 0;
  channels.forEach((ch) => {
    if (addChannel(ch)) addedCount++;
  });
  if (addedCount > 0) showToast(`팔로우 채널 ${addedCount}개 추가됨`);
  else showToast('새로 추가된 채널이 없어요');
}
```

- [ ] **Step 3: 기존 `btnConnectExt` 클릭 핸들러 교체**

기존 코드:
```js
els.btnConnectExt.addEventListener('click', () => {
  if (!window.EXTENSION_ID || window.EXTENSION_ID === 'YOUR_EXTENSION_ID_HERE') {
    showToast('config.js에 EXTENSION_ID를 먼저 설정해주세요.');
    return;
  }
  if (!window.chrome?.runtime?.sendMessage) {
    showToast('크롬 기반 브라우저에서만 확장프로그램 연동이 가능해요.');
    return;
  }

  showToast('확장프로그램에서 팔로우 목록을 가져오는 중…');
  chrome.runtime.sendMessage(window.EXTENSION_ID, { type: 'FETCH_FOLLOWINGS' }, (response) => {
    if (chrome.runtime.lastError) {
      showToast('확장프로그램을 찾을 수 없어요. 설치/활성화 여부를 확인해주세요.');
      els.btnConnectExt.classList.remove('connected');
      return;
    }
    if (!response?.ok) {
      showToast(`가져오기 실패: ${response?.error ?? '알 수 없는 오류'}`);
      return;
    }

    let addedCount = 0;
    response.channels.forEach((ch) => {
      if (addChannel({
        channelId: ch.channelId,
        channelName: ch.channelName,
        channelImageUrl: ch.channelImageUrl,
      })) addedCount += 1;
    });

    els.btnConnectExt.classList.add('connected');
    showToast(`팔로우 채널 ${response.channels.length}개 중 ${addedCount}개 새로 추가됨`);
  });
});
```

교체 후:
```js
els.btnConnectExt.addEventListener('click', () => {
  if (!window.EXTENSION_ID || window.EXTENSION_ID === 'YOUR_EXTENSION_ID_HERE') {
    showToast('config.js에 EXTENSION_ID를 먼저 설정해주세요.');
    return;
  }
  if (!window.chrome?.runtime?.connect) {
    showToast('크롬 기반 브라우저에서만 확장프로그램 연동이 가능해요.');
    return;
  }
  if (extPort) {
    showToast('이미 연결됨. 팔로우 목록을 가져오는 중이에요.');
    return;
  }
  connectExtension();
  showToast('확장프로그램에 연결 중…');
});
```

- [ ] **Step 4: 초기화 블록에 `connectExtension()` 호출 추가**

파일 맨 아래 초기화 블록:
```js
// ── 초기화 ──
renderMyChannels();
loadFeed();
connectExtension();
```

---

### Task 5: 동작 확인

- [ ] **Step 1: 확장프로그램 ID 확인 및 config.js 설정**

`chrome://extensions` → Chwitter 카드에서 ID 복사 (예: `abcdefghijklmnopqrstuvwxyz123456`)

`frontend/config.js`:
```js
window.BACKEND_URL = 'http://localhost:4000';
window.EXTENSION_ID = '여기에_복사한_ID_입력';
```

- [ ] **Step 2: 백엔드 + 프론트엔드 실행**

터미널 1:
```bash
cd backend && node server.js
```
Expected: `Chzzk Feed 백엔드 실행 중 → http://localhost:4000`

터미널 2:
```bash
cd frontend && npx serve .
```
Expected: 정적 서버 실행 (포트 확인 후 `WEB_APP_URL` 상수와 일치 여부 체크)

- [ ] **Step 3: 웹앱 열고 자동 연결 확인**

브라우저에서 웹앱 URL 열기 → 치지직에 로그인된 상태여야 함.

확인 항목:
- 상단 확장프로그램 버튼 도트가 mint 색으로 바뀜 (`.connected` 클래스 추가됨)
- 수 초 내에 "팔로우 채널 N개 추가됨" 토스트 표시
- 사이드바에 팔로우 채널 목록 표시
- 피드에 게시글 로드

- [ ] **Step 4: 아이콘 클릭 확인**

Chrome 툴바의 Chwitter 아이콘 클릭 → 이미 열린 웹앱 탭으로 포커스 이동. 웹앱 탭이 없으면 `WEB_APP_URL`로 새 탭 열림.

- [ ] **Step 5: 캐시 확인**

웹앱 새로고침 → 즉시 (1초 이내) 팔로우 목록 수신 (캐시 hit, chzzk 탭 열지 않음).

- [ ] **Step 6: 오류 시나리오 확인**

치지직 탭을 모두 닫은 상태에서 웹앱 새로고침 (캐시 만료 상황은 `chrome.storage.local`에서 `chwitter_followings` 항목 삭제로 재현) → background가 새 chzzk 탭을 열고 팔로우 목록을 수집해오는 것 확인.
