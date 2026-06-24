// vod.js
const STORAGE_KEY = 'cf_channels';
const PAGE_SIZE = 12;

const els = {
  categorySelect: document.getElementById('vod-category-select'),
  keywordInput: document.getElementById('vod-keyword-input'),
  channelList: document.getElementById('vod-channel-list'),
  selectedCount: document.getElementById('channel-selected-count'),
  totalCount: document.getElementById('channel-total-count'),
  btnSelectAll: document.getElementById('btn-select-all'),
  btnDeselectAll: document.getElementById('btn-deselect-all'),
  btnConnectExt: document.getElementById('btn-connect-ext'),
  vodEmpty: document.getElementById('vod-empty'),
  vodLoading: document.getElementById('vod-loading'),
  vodError: document.getElementById('vod-error'),
  vodErrorMsg: document.getElementById('vod-error-msg'),
  vodGrid: document.getElementById('vod-grid'),
  toast: document.getElementById('toast'),
};

let myChannels = [];
let selectedChannelIds = new Set();
let allVods = [];
let extPort = null;
let isLoading = false;
let exhausted = false;
let currentPage = 0;
let feedVersion = 0;
let vodObserver = null;

function loadChannels() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) ?? []; }
  catch { return []; }
}

// ── 상태 표시 ──
function setVodState(state, errorMsg) {
  els.vodEmpty.hidden = state !== 'empty';
  els.vodLoading.hidden = state !== 'loading';
  els.vodError.hidden = state !== 'error';
  els.vodGrid.hidden = state !== 'grid';
  if (state === 'error') els.vodErrorMsg.textContent = errorMsg || '잠시 후 다시 시도해주세요.';
}

// ── 사이드바: 채널 목록 ──
function renderChannelList() {
  els.channelList.innerHTML = '';
  els.totalCount.textContent = myChannels.length;
  els.selectedCount.textContent = selectedChannelIds.size;

  if (myChannels.length === 0) {
    const li = document.createElement('li');
    li.className = 'empty-hint';
    li.textContent = '피드에서 채널을 추가하면 여기 표시돼요.';
    els.channelList.appendChild(li);
    return;
  }

  myChannels.forEach((ch) => {
    const count = allVods.filter((v) => v.channelId === ch.channelId).length;
    const checked = selectedChannelIds.has(ch.channelId);
    const li = document.createElement('li');
    li.className = 'vod-channel-item';
    li.innerHTML = `
      <label class="vod-channel-label">
        <input type="checkbox" class="vod-channel-cb" data-id="${ch.channelId}" ${checked ? 'checked' : ''} />
        <img src="${ch.channelImageUrl || ''}" alt="" onerror="this.style.visibility='hidden'" />
        <span class="vod-channel-name">${escapeHtml(ch.channelName)}</span>
        <span class="vod-channel-count">${count}</span>
      </label>
    `;
    els.channelList.appendChild(li);
  });
}

// ── 카테고리 드롭다운 ──
function buildCategorySelect() {
  const current = els.categorySelect.value;
  const categories = [...new Set(allVods.map((v) => v.category).filter(Boolean))].sort();
  els.categorySelect.innerHTML = '<option value="">전체 카테고리</option>';
  categories.forEach((cat) => {
    const opt = document.createElement('option');
    opt.value = cat;
    opt.textContent = cat;
    if (cat === current) opt.selected = true;
    els.categorySelect.appendChild(opt);
  });
}

// ── 필터링 및 렌더링 ──
function getFilteredVods() {
  const category = els.categorySelect.value;
  const keyword = els.keywordInput.value.trim().toLowerCase();
  return allVods.filter((v) => {
    if (!selectedChannelIds.has(v.channelId)) return false;
    if (category && v.category !== category) return false;
    if (keyword) {
      const inTitle = v.title.toLowerCase().includes(keyword);
      const inTags = v.tags.some((t) => t.toLowerCase().includes(keyword));
      if (!inTitle && !inTags) return false;
    }
    return true;
  });
}

function applyFilters() {
  const vods = getFilteredVods();
  if (vods.length === 0 && allVods.length > 0) {
    setVodState('empty');
    const title = els.vodEmpty.querySelector('.feed-state-title');
    if (title) title.textContent = '조건에 맞는 VOD가 없어요';
    return;
  }
  renderGrid(vods);
}

function renderGrid(vods) {
  if (!vods || vods.length === 0) {
    setVodState('empty');
    return;
  }
  setVodState('grid');
  els.vodGrid.innerHTML = '';
  vods.forEach((v) => els.vodGrid.appendChild(buildVodCard(v)));
}

// ── VOD 카드 ──
function buildVodCard(v) {
  const ch = myChannels.find((c) => c.channelId === v.channelId);
  const li = document.createElement('li');
  li.className = 'vod-card';
  li.innerHTML = `
    <a class="vod-thumb-link" href="https://chzzk.naver.com/video/${v.videoNo}" target="_blank" rel="noopener noreferrer">
      <div class="vod-thumb">
        <img src="${v.thumbnailImageUrl || ''}" alt="" />
        ${v.duration ? `<span class="vod-duration">${formatDuration(v.duration)}</span>` : ''}
      </div>
    </a>
    <div class="vod-info">
      <a class="vod-channel-link" href="https://chzzk.naver.com/${v.channelId}" target="_blank" rel="noopener noreferrer">
        <img src="${ch?.channelImageUrl || ''}" alt="" onerror="this.style.visibility='hidden'" />
        <span class="vod-channel-name-small">${escapeHtml(ch?.channelName || '')}</span>
      </a>
      <a class="vod-title" href="https://chzzk.naver.com/video/${v.videoNo}" target="_blank" rel="noopener noreferrer">${escapeHtml(v.title)}</a>
      <div class="vod-meta">
        ${v.category ? `<span class="vod-category">${escapeHtml(v.category)}</span>` : ''}
        <span>${formatCount(v.readCount)} · ${formatDate(v.publishDateAt)}</span>
      </div>
    </div>
  `;
  return li;
}

// ── 데이터 로딩 ──
async function loadVods() {
  if (myChannels.length === 0) { setVodState('empty'); return; }

  const version = ++feedVersion;
  isLoading = true;
  exhausted = false;
  currentPage = 0;
  allVods = [];
  if (vodObserver) { vodObserver.disconnect(); vodObserver = null; }
  setVodState('loading');

  try {
    const ids = myChannels.map((c) => c.channelId).join(',');
    const res = await fetch(`${window.BACKEND_URL}/api/vods?channelIds=${encodeURIComponent(ids)}&page=0&size=${PAGE_SIZE}`);
    const json = await res.json();
    if (!json.ok) throw new Error(json.error);
    if (version !== feedVersion) return;

    allVods = json.vods ?? [];
    buildCategorySelect();
    renderChannelList();
    applyFilters();
    if (allVods.length >= PAGE_SIZE) setupObserver();
    else exhausted = true;
  } catch (err) {
    if (version === feedVersion) setVodState('error', err.message);
  } finally {
    isLoading = false;
  }
}

// ── 무한 스크롤 ──
function setupObserver() {
  const sentinel = document.getElementById('vod-sentinel');
  vodObserver = new IntersectionObserver(async (entries) => {
    if (!entries[0].isIntersecting || isLoading || exhausted) return;
    const version = feedVersion;
    isLoading = true;
    currentPage++;

    try {
      const ids = myChannels.map((c) => c.channelId).join(',');
      const res = await fetch(
        `${window.BACKEND_URL}/api/vods?channelIds=${encodeURIComponent(ids)}&page=${currentPage}&size=${PAGE_SIZE}`
      );
      const json = await res.json();
      if (!json.ok || version !== feedVersion) return;

      const newVods = json.vods ?? [];
      if (newVods.length === 0) {
        exhausted = true;
        vodObserver.disconnect();
      } else {
        allVods = allVods.concat(newVods);
        buildCategorySelect();
        renderChannelList();
        applyFilters();
        if (newVods.length < PAGE_SIZE) { exhausted = true; vodObserver.disconnect(); }
      }
    } catch {
      showToast('더 불러오지 못했어요');
    } finally {
      isLoading = false;
    }
  }, { rootMargin: '300px' });
  vodObserver.observe(sentinel);
}

// ── 채널 체크박스 이벤트 ──
els.channelList.addEventListener('change', (e) => {
  const cb = e.target.closest('.vod-channel-cb');
  if (!cb) return;
  if (cb.checked) selectedChannelIds.add(cb.dataset.id);
  else selectedChannelIds.delete(cb.dataset.id);
  els.selectedCount.textContent = selectedChannelIds.size;
  applyFilters();
});

els.btnSelectAll.addEventListener('click', () => {
  selectedChannelIds = new Set(myChannels.map((c) => c.channelId));
  renderChannelList();
  applyFilters();
});

els.btnDeselectAll.addEventListener('click', () => {
  selectedChannelIds.clear();
  renderChannelList();
  applyFilters();
});

// ── 필터 이벤트 ──
els.categorySelect.addEventListener('change', applyFilters);
let keywordTimer = null;
els.keywordInput.addEventListener('input', () => {
  clearTimeout(keywordTimer);
  keywordTimer = setTimeout(applyFilters, 300);
});

// ── 확장프로그램 연동 ──
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
  } catch {}
}

function applyFollowings(channels) {
  const before = myChannels.length;
  channels.forEach((ch) => {
    if (!myChannels.some((c) => c.channelId === ch.channelId)) myChannels.push(ch);
  });
  const added = myChannels.length - before;
  if (added > 0) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(myChannels));
    selectedChannelIds = new Set(myChannels.map((c) => c.channelId));
    loadVods();
    showToast(`팔로우 채널 ${added}개 추가됨`);
  } else {
    showToast('새로 추가된 채널이 없어요');
  }
}

els.btnConnectExt.addEventListener('click', () => {
  if (!window.EXTENSION_ID || window.EXTENSION_ID === 'YOUR_EXTENSION_ID_HERE') {
    showToast('config.js에 EXTENSION_ID를 먼저 설정해주세요.');
    return;
  }
  if (!window.chrome?.runtime?.connect) {
    showToast('크롬 기반 브라우저에서만 확장프로그램 연동이 가능해요.');
    return;
  }
  if (extPort) { showToast('이미 연결됨. 팔로우 목록을 가져오는 중이에요.'); return; }
  connectExtension();
  showToast('확장프로그램에 연결 중…');
});

// ── 사이드바 토글 ──
const layout = document.querySelector('.layout');
const backdrop = document.getElementById('sidebar-backdrop');
const SIDEBAR_BREAK = 768;
let autoCollapsed = false;

function isMobile() { return window.innerWidth <= SIDEBAR_BREAK; }
function showSidebar() { layout.classList.remove('sidebar-hidden'); if (isMobile()) backdrop.classList.add('visible'); }
function hideSidebar() { layout.classList.add('sidebar-hidden'); backdrop.classList.remove('visible'); }

document.getElementById('btn-toggle-sidebar').addEventListener('click', () => {
  layout.classList.contains('sidebar-hidden') ? showSidebar() : hideSidebar();
  autoCollapsed = false;
});
backdrop.addEventListener('click', () => hideSidebar());
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !layout.classList.contains('sidebar-hidden')) hideSidebar();
});
window.addEventListener('resize', () => {
  if (window.innerWidth < SIDEBAR_BREAK) {
    if (!layout.classList.contains('sidebar-hidden')) { hideSidebar(); autoCollapsed = true; }
  } else {
    backdrop.classList.remove('visible');
    if (autoCollapsed) { showSidebar(); autoCollapsed = false; }
  }
});
if (isMobile()) { hideSidebar(); autoCollapsed = true; }

// ── 토스트 ──
function showToast(msg, ms = 2600) {
  els.toast.textContent = msg;
  els.toast.hidden = false;
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => { els.toast.hidden = true; }, ms);
}

// ── 유틸 ──
function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function formatDuration(secs) {
  if (!secs) return '';
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;
}

function formatCount(n) {
  if (n >= 10000) return `${(n / 10000).toFixed(1)}만`;
  return String(n ?? 0);
}

function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const diffMin = Math.floor((Date.now() - d.getTime()) / 60000);
  if (diffMin < 1) return '방금';
  if (diffMin < 60) return `${diffMin}분 전`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour}시간 전`;
  return `${Math.floor(diffHour / 24)}일 전`;
}

// ── 초기화 ──
myChannels = loadChannels();
selectedChannelIds = new Set(myChannels.map((c) => c.channelId));
renderChannelList();
loadVods();
connectExtension();
