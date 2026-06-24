const CHZZK_ORIGIN   = 'https://chzzk.naver.com';
const API_BASE       = 'https://api.chzzk.naver.com/service/v1';
const FOLLOWINGS_KEY = 'chwitter_followings';
const FOLLOWINGS_TTL = 30 * 60 * 1000;
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
