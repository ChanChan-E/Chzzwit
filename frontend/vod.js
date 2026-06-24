// vod.js
const STORAGE_KEY = 'cf_channels';
const SLIDER_LIMIT = 30;   // 슬라이더 모드에서 표시하는 최대 카드 수
const EXPAND_STEP  = 20;   // 펼치기/더보기 1회당 추가 카드 수

const els = {
  categoryInput: document.getElementById('vod-category-input'),
  categorySuggestions: document.getElementById('vod-category-suggestions'),
  keywordInput: document.getElementById('vod-keyword-input'),
  channelSearchInput: document.getElementById('vod-channel-search-input'),
  channelSearchResults: document.getElementById('vod-search-results'),
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
let feedVersion = 0;
let viewMode = 'section'; // 'section' | 'grid'
let sectionShowCount = new Map(); // channelId → 펼침 카드 수 (0 = 슬라이더)

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

// ── 카테고리 자동완성 ──
let allCategories = [];
let activeCategory = '';

function buildCategories() {
  allCategories = [...new Set(allVods.map((v) => v.category).filter(Boolean))].sort();
}

function showCategorySuggestions(query) {
  const q = query.trim().toLowerCase();
  const matches = q ? allCategories.filter((c) => c.toLowerCase().includes(q)) : allCategories;
  els.categorySuggestions.innerHTML = '';
  if (matches.length === 0) { els.categorySuggestions.hidden = true; return; }
  matches.forEach((cat) => {
    const li = document.createElement('li');
    li.textContent = cat;
    li.addEventListener('mousedown', (e) => {
      e.preventDefault();
      activeCategory = cat;
      els.categoryInput.value = cat;
      els.categorySuggestions.hidden = true;
      applyFilters();
    });
    els.categorySuggestions.appendChild(li);
  });
  els.categorySuggestions.hidden = false;
}

els.categoryInput.addEventListener('input', () => {
  activeCategory = '';
  showCategorySuggestions(els.categoryInput.value);
});
els.categoryInput.addEventListener('focus', () => showCategorySuggestions(els.categoryInput.value));
els.categoryInput.addEventListener('blur', () => {
  setTimeout(() => { els.categorySuggestions.hidden = true; }, 150);
  if (!activeCategory) { els.categoryInput.value = ''; applyFilters(); }
});
els.categoryInput.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    activeCategory = '';
    els.categoryInput.value = '';
    els.categorySuggestions.hidden = true;
    applyFilters();
  }
});
document.addEventListener('click', (e) => {
  if (!els.categoryInput.contains(e.target) && !els.categorySuggestions.contains(e.target)) {
    els.categorySuggestions.hidden = true;
  }
});

// ── 필터링 및 렌더링 ──
function getFilteredVods() {
  const category = activeCategory;
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
  if (viewMode === 'section') renderSections(vods);
  else renderGrid(vods);
}

function renderSections(vods) {
  if (!vods || vods.length === 0) { setVodState('empty'); return; }
  setVodState('grid');
  els.vodGrid.className = 'vod-sections';
  els.vodGrid.innerHTML = '';

  let rendered = 0;
  myChannels
    .filter((ch) => selectedChannelIds.has(ch.channelId))
    .forEach((ch) => {
      const chVods = vods.filter((v) => v.channelId === ch.channelId);
      if (chVods.length === 0) return;
      const showCount = sectionShowCount.get(ch.channelId) ?? 0;
      els.vodGrid.appendChild(buildSection(ch, chVods, showCount));
      rendered++;
    });

  if (rendered === 0) setVodState('empty');
}

function buildSection(ch, chVods, showCount) {
  const section = document.createElement('li');
  section.className = 'vod-section';

  const isExpanded = showCount > 0;
  const header = document.createElement('div');
  header.className = 'vod-section-header';
  header.innerHTML = `
    <a class="vod-section-channel" href="https://chzzk.naver.com/${ch.channelId}" target="_blank" rel="noopener noreferrer">
      <img src="${ch.channelImageUrl || ''}" alt="" onerror="this.style.visibility='hidden'" />
      <span class="vod-section-name">${escapeHtml(ch.channelName)}</span>
      <span class="vod-section-count">${chVods.length}개</span>
    </a>
    <button class="vod-section-expand-btn${isExpanded ? ' expanded' : ''}" data-action="expand" data-id="${ch.channelId}">
      ${isExpanded ? '접기 ▲' : '펼치기 ▼'}
    </button>
  `;
  section.appendChild(header);

  if (!isExpanded) {
    const sliderVods = chVods.slice(0, SLIDER_LIMIT);
    section.appendChild(buildSlider(sliderVods, chVods.length > SLIDER_LIMIT ? ch.channelId : null, chVods.length));
  } else {
    const visible = Math.min(showCount, chVods.length);
    const grid = document.createElement('div');
    grid.className = 'vod-section-grid';
    chVods.slice(0, visible).forEach((v) => grid.appendChild(buildVodCard(v)));

    if (visible < chVods.length) {
      const remaining = chVods.length - visible;
      const moreBtn = document.createElement('button');
      moreBtn.className = 'vod-section-more-btn';
      moreBtn.dataset.action = 'more';
      moreBtn.dataset.id = ch.channelId;
      moreBtn.innerHTML = `
        <span class="vod-more-icon">▶</span>
        <span class="vod-more-label">더 보기</span>
        <span class="vod-more-count">${remaining}개 남음</span>
      `;
      grid.appendChild(moreBtn);
    }
    section.appendChild(grid);
  }
  return section;
}

function buildSlider(vods, expandChannelId, totalCount) {
  const wrap = document.createElement('div');
  wrap.className = 'vod-slider-wrap';

  const track = document.createElement('div');
  track.className = 'vod-slider-track';
  vods.forEach((v) => track.appendChild(buildVodCard(v)));

  if (expandChannelId) {
    const expandCard = document.createElement('button');
    expandCard.className = 'vod-slider-expand-card';
    expandCard.dataset.action = 'expand';
    expandCard.dataset.id = expandChannelId;
    expandCard.innerHTML = `
      <span class="vod-expand-icon">▶</span>
      <span class="vod-expand-label">펼치기</span>
      <span class="vod-expand-count">${totalCount}개 보기</span>
    `;
    track.appendChild(expandCard);
  }

  const prevBtn = document.createElement('button');
  prevBtn.className = 'vod-slider-btn prev';
  prevBtn.innerHTML = '‹';
  prevBtn.hidden = true;

  const nextBtn = document.createElement('button');
  nextBtn.className = 'vod-slider-btn next';
  nextBtn.innerHTML = '›';
  nextBtn.hidden = vods.length <= 4;

  const scrollAmt = () => track.clientWidth * 0.85;

  prevBtn.addEventListener('click', () => track.scrollBy({ left: -scrollAmt(), behavior: 'smooth' }));
  nextBtn.addEventListener('click', () => {
    const isAtEnd = track.scrollLeft + track.clientWidth >= track.scrollWidth - 10;
    if (isAtEnd && expandChannelId) {
      sectionShowCount.set(expandChannelId, EXPAND_STEP);
      applyFilters();
      return;
    }
    track.scrollBy({ left: scrollAmt(), behavior: 'smooth' });
  });

  track.addEventListener('scroll', () => {
    prevBtn.hidden = track.scrollLeft < 10;
    const isAtEnd = track.scrollLeft + track.clientWidth >= track.scrollWidth - 10;
    if (expandChannelId) {
      nextBtn.innerHTML = isAtEnd ? '펼치기' : '›';
      nextBtn.style.fontSize = isAtEnd ? '13px' : '';
      nextBtn.hidden = false;
    } else {
      nextBtn.hidden = isAtEnd;
    }
  });

  wrap.appendChild(prevBtn);
  wrap.appendChild(track);
  wrap.appendChild(nextBtn);
  return wrap;
}

function renderGrid(vods) {
  if (!vods || vods.length === 0) {
    setVodState('empty');
    return;
  }
  setVodState('grid');
  els.vodGrid.className = 'vod-grid';
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
      ${v.tags?.length ? `<div class="vod-tags">${v.tags.map((t) => `<span class="vod-tag">#${escapeHtml(t)}</span>`).join('')}</div>` : ''}
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
  allVods = [];
  sectionShowCount = new Map();
  setVodState('loading');

  try {
    const ids = myChannels.map((c) => c.channelId).join(',');
    const res = await fetch(`${window.BACKEND_URL}/api/vods?channelIds=${encodeURIComponent(ids)}`);
    const json = await res.json();
    if (!json.ok) throw new Error(json.error);
    if (version !== feedVersion) return;

    allVods = json.vods ?? [];
    buildCategories();
    renderChannelList();
    applyFilters();
  } catch (err) {
    if (version === feedVersion) setVodState('error', err.message);
  } finally {
    isLoading = false;
  }
}

// ── 채널 검색 및 추가 (사이드바) ──
let channelSearchTimer = null;
els.channelSearchInput.addEventListener('input', () => {
  clearTimeout(channelSearchTimer);
  const keyword = els.channelSearchInput.value.trim();
  if (!keyword) { els.channelSearchResults.hidden = true; return; }
  channelSearchTimer = setTimeout(() => runChannelSearch(keyword), 300);
});

async function runChannelSearch(keyword) {
  try {
    const res = await fetch(`${window.BACKEND_URL}/api/channels/search?keyword=${encodeURIComponent(keyword)}`);
    const json = await res.json();
    if (!json.ok) throw new Error(json.error);
    renderChannelSearchResults(json.channels);
  } catch (err) {
    showToast(`검색 실패: ${err.message}`);
  }
}

function renderChannelSearchResults(channels) {
  els.channelSearchResults.innerHTML = '';
  if (channels.length === 0) { els.channelSearchResults.hidden = true; return; }
  channels.forEach((ch) => {
    const li = document.createElement('li');
    li.innerHTML = `
      <img src="${ch.channelImageUrl || ''}" alt="" onerror="this.style.visibility='hidden'" />
      <span class="s-name">${escapeHtml(ch.channelName)}</span>
      <span class="s-follower mono">${formatCount(ch.followerCount)}</span>
    `;
    li.addEventListener('click', () => {
      addChannel(ch);
      els.channelSearchResults.hidden = true;
      els.channelSearchInput.value = '';
    });
    els.channelSearchResults.appendChild(li);
  });
  els.channelSearchResults.hidden = false;
}

function addChannel(channel) {
  if (myChannels.some((c) => c.channelId === channel.channelId)) {
    showToast('이미 추가된 채널이에요');
    return;
  }
  myChannels.push(channel);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(myChannels));
  selectedChannelIds.add(channel.channelId);
  showToast(`${channel.channelName} 추가됨`);
  loadVods();
}

document.addEventListener('click', (e) => {
  if (!els.channelSearchResults.contains(e.target) && e.target !== els.channelSearchInput) {
    els.channelSearchResults.hidden = true;
  }
});

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

// ── 섹션 펼치기/더보기 이벤트 위임 ──
els.vodGrid.addEventListener('click', (e) => {
  const expandBtn = e.target.closest('[data-action="expand"]');
  if (expandBtn) {
    const id = expandBtn.dataset.id;
    if ((sectionShowCount.get(id) ?? 0) > 0) sectionShowCount.delete(id);
    else sectionShowCount.set(id, EXPAND_STEP);
    applyFilters();
    return;
  }
  const moreBtn = e.target.closest('[data-action="more"]');
  if (moreBtn) {
    const id = moreBtn.dataset.id;
    sectionShowCount.set(id, (sectionShowCount.get(id) ?? EXPAND_STEP) + EXPAND_STEP);
    applyFilters();
  }
});

// ── 뷰 모드 토글 ──
document.getElementById('btn-view-section').addEventListener('click', () => {
  if (viewMode === 'section') return;
  viewMode = 'section';
  document.getElementById('btn-view-section').classList.add('active');
  document.getElementById('btn-view-grid').classList.remove('active');
  applyFilters();
});
document.getElementById('btn-view-grid').addEventListener('click', () => {
  if (viewMode === 'grid') return;
  viewMode = 'grid';
  document.getElementById('btn-view-grid').classList.add('active');
  document.getElementById('btn-view-section').classList.remove('active');
  applyFilters();
});

// ── 필터 이벤트 ──
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
