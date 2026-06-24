// app.js
const STORAGE_KEY = 'cf_channels';
const SELECTED_KEY = 'cf_selected_channels';
const PAGE_SIZE = 10;

const els = {
  searchInput: document.getElementById('channel-search-input'),
  searchResults: document.getElementById('search-results'),
  myChannels: document.getElementById('my-channels'),
  channelSelectedCount: document.getElementById('channel-selected-count'),
  channelTotalCount: document.getElementById('channel-total-count'),
  btnSelectAll: document.getElementById('btn-select-all-ch'),
  btnDeselectAll: document.getElementById('btn-deselect-all-ch'),
  btnConnectExt: document.getElementById('btn-connect-ext'),
  feedEmpty: document.getElementById('feed-empty'),
  feedLoading: document.getElementById('feed-loading'),
  feedError: document.getElementById('feed-error'),
  feedErrorMsg: document.getElementById('feed-error-msg'),
  feedList: document.getElementById('feed-list'),
  toast: document.getElementById('toast'),
};

// ── 확장프로그램 포트 상태 ──
let extPort = null;

// ── 상태: 추가된 채널 목록 (localStorage에 영속화, 서버에 계정/로그인 불필요) ──
function loadChannels() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) ?? []; }
  catch { return []; }
}
function saveChannels(list) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
}
function loadSelectedIds(channels) {
  try {
    const saved = JSON.parse(localStorage.getItem(SELECTED_KEY));
    if (Array.isArray(saved)) return new Set(saved);
  } catch {}
  // 기본값: 전체 선택
  return new Set(channels.map((c) => c.channelId));
}
function saveSelectedIds() {
  localStorage.setItem(SELECTED_KEY, JSON.stringify([...selectedChannelIds]));
}

let myChannels = loadChannels();
let selectedChannelIds = loadSelectedIds(myChannels);

// ── 페이지네이션 상태 ──
let channelOffsets = {};   // { channelId: number }
let exhausted = {};        // { channelId: boolean }
let isLoadingMore = false;
let allPosts = [];
let feedObserver = null;
let feedVersion = 0;

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
  const before = myChannels.length;
  channels.forEach((ch) => {
    if (!myChannels.some((c) => c.channelId === ch.channelId)) {
      myChannels.push(ch);
      selectedChannelIds.add(ch.channelId);
    }
  });
  const addedCount = myChannels.length - before;
  if (addedCount > 0) {
    saveChannels(myChannels);
    saveSelectedIds();
    renderMyChannels();
    loadFeed();
    showToast(`팔로우 채널 ${addedCount}개 추가됨`);
  } else {
    showToast('새로 추가된 채널이 없어요');
  }
}

function showToast(msg, ms = 2600) {
  els.toast.textContent = msg;
  els.toast.hidden = false;
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => { els.toast.hidden = true; }, ms);
}

// ── 사이드바: 내 채널 목록 렌더 ──
function renderMyChannels() {
  els.channelTotalCount.textContent = myChannels.length;
  els.channelSelectedCount.textContent = selectedChannelIds.size;
  els.myChannels.innerHTML = '';

  if (myChannels.length === 0) {
    const li = document.createElement('li');
    li.className = 'empty-hint';
    li.innerHTML = '검색해서 채널을 추가하거나,<br />확장프로그램으로 팔로우를 가져와보세요.';
    els.myChannels.appendChild(li);
    return;
  }

  myChannels.forEach((ch) => {
    const checked = selectedChannelIds.has(ch.channelId);
    const count = allPosts.filter((p) => p.channelId === ch.channelId).length;
    const li = document.createElement('li');
    li.className = 'vod-channel-item';
    li.innerHTML = `
      <label class="vod-channel-label">
        <input type="checkbox" class="ch-cb" data-id="${ch.channelId}" ${checked ? 'checked' : ''} />
        <img src="${ch.channelImageUrl || ''}" alt="" onerror="this.style.visibility='hidden'" />
        <span class="vod-channel-name">${escapeHtml(ch.channelName)}</span>
        <span class="vod-channel-count">${count || ''}</span>
      </label>
      <button class="ch-remove" data-id="${ch.channelId}" title="목록에서 제거">✕</button>
    `;
    els.myChannels.appendChild(li);
  });
}

els.myChannels.addEventListener('change', (e) => {
  const cb = e.target.closest('.ch-cb');
  if (!cb) return;
  if (cb.checked) selectedChannelIds.add(cb.dataset.id);
  else selectedChannelIds.delete(cb.dataset.id);
  saveSelectedIds();
  els.channelSelectedCount.textContent = selectedChannelIds.size;
  loadFeed();
});

els.myChannels.addEventListener('click', (e) => {
  const btn = e.target.closest('.ch-remove');
  if (!btn) return;
  removeChannel(btn.dataset.id);
});

els.btnSelectAll.addEventListener('click', () => {
  selectedChannelIds = new Set(myChannels.map((c) => c.channelId));
  saveSelectedIds();
  renderMyChannels();
  loadFeed();
});

els.btnDeselectAll.addEventListener('click', () => {
  selectedChannelIds.clear();
  saveSelectedIds();
  renderMyChannels();
  loadFeed();
});

function addChannel(channel) {
  if (myChannels.some((c) => c.channelId === channel.channelId)) return false;
  myChannels.push(channel);
  selectedChannelIds.add(channel.channelId);
  saveChannels(myChannels);
  saveSelectedIds();
  renderMyChannels();
  loadFeed();
  return true;
}

function removeChannel(channelId) {
  myChannels = myChannels.filter((c) => c.channelId !== channelId);
  selectedChannelIds.delete(channelId);
  saveChannels(myChannels);
  saveSelectedIds();
  renderMyChannels();
  loadFeed();
}

// ── 사이드바 토글 ──
const layout = document.querySelector('.layout');
const backdrop = document.getElementById('sidebar-backdrop');
const SIDEBAR_BREAK = 768;
let autoCollapsed = false;

function isMobile() { return window.innerWidth <= SIDEBAR_BREAK; }

function showSidebar() {
  layout.classList.remove('sidebar-hidden');
  if (isMobile()) backdrop.classList.add('visible');
}

function hideSidebar() {
  layout.classList.add('sidebar-hidden');
  backdrop.classList.remove('visible');
}

document.getElementById('btn-toggle-sidebar').addEventListener('click', () => {
  if (layout.classList.contains('sidebar-hidden')) {
    showSidebar();
  } else {
    hideSidebar();
  }
  autoCollapsed = false;
});

backdrop.addEventListener('click', () => hideSidebar());

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (!lightbox.hidden) { lightbox.hidden = true; lightboxImg.src = ''; return; }
  if (!layout.classList.contains('sidebar-hidden')) hideSidebar();
});

window.addEventListener('resize', () => {
  if (window.innerWidth < SIDEBAR_BREAK) {
    if (!layout.classList.contains('sidebar-hidden')) {
      hideSidebar();
      autoCollapsed = true;
    }
  } else {
    backdrop.classList.remove('visible');
    if (autoCollapsed) {
      showSidebar();
      autoCollapsed = false;
    }
  }
});

if (window.innerWidth < SIDEBAR_BREAK) {
  hideSidebar();
  autoCollapsed = true;
}

// ── 이미지 캐러셀 ──
els.feedList.addEventListener('click', (e) => {
  const btn = e.target.closest('.img-nav');
  if (!btn) return;
  const carousel = btn.closest('.carousel');
  const track = carousel.querySelector('.img-track');
  const total = track.children.length;
  let slide = parseInt(carousel.dataset.slide, 10);
  slide = btn.classList.contains('img-prev') ? (slide - 1 + total) % total : (slide + 1) % total;
  carousel.dataset.slide = slide;
  track.style.transform = `translateX(-${slide * 100}%)`;
  carousel.querySelectorAll('.img-dot').forEach((d, i) => d.classList.toggle('active', i === slide));
});

// ── 채널 검색 ──
let searchTimer = null;
els.searchInput.addEventListener('input', () => {
  clearTimeout(searchTimer);
  const keyword = els.searchInput.value.trim();
  if (!keyword) { els.searchResults.hidden = true; return; }
  searchTimer = setTimeout(() => runSearch(keyword), 300);
});

async function runSearch(keyword) {
  try {
    const res = await fetch(`${window.BACKEND_URL}/api/channels/search?keyword=${encodeURIComponent(keyword)}`);
    const json = await res.json();
    if (!json.ok) throw new Error(json.error);
    renderSearchResults(json.channels);
  } catch (err) {
    showToast(`검색 실패: ${err.message}`);
  }
}

function renderSearchResults(channels) {
  els.searchResults.innerHTML = '';
  if (channels.length === 0) {
    els.searchResults.hidden = true;
    return;
  }
  channels.forEach((ch) => {
    const li = document.createElement('li');
    li.innerHTML = `
      <img src="${ch.channelImageUrl || ''}" alt="" onerror="this.style.visibility='hidden'" />
      <span class="s-name">${escapeHtml(ch.channelName)}</span>
      <span class="s-follower mono">${formatCount(ch.followerCount)}</span>
    `;
    li.addEventListener('click', () => {
      const added = addChannel(ch);
      showToast(added ? `${ch.channelName} 추가됨` : `이미 추가된 채널이에요`);
      els.searchResults.hidden = true;
      els.searchInput.value = '';
    });
    els.searchResults.appendChild(li);
  });
  els.searchResults.hidden = false;
}

document.addEventListener('click', (e) => {
  if (!els.searchResults.contains(e.target) && e.target !== els.searchInput) {
    els.searchResults.hidden = true;
  }
});

// ── 피드: 이미지 섹션 ──
function buildImageSection(urls) {
  if (!urls?.length) return '';
  if (urls.length === 1) {
    return `<div class="feed-card-images"><img src="${urls[0]}" alt="" /></div>`;
  }
  const imgs = urls.map((u) => `<img src="${u}" alt="" />`).join('');
  const dots = urls.map((_, i) => `<span class="img-dot${i === 0 ? ' active' : ''}"></span>`).join('');
  return `<div class="feed-card-images carousel" data-slide="0"><div class="img-track">${imgs}</div><button class="img-nav img-prev" aria-label="이전">&#8249;</button><button class="img-nav img-next" aria-label="다음">&#8250;</button><div class="img-dots">${dots}</div></div>`;
}

// ── 피드: 카드 생성 ──
function buildFeedCard(post) {
  const channel = myChannels.find((c) => c.channelId === post.channelId);
  const li = document.createElement('li');
  li.className = 'feed-card';
  li.innerHTML = `
    <div class="feed-card-head">
      <a class="feed-card-channel-link" href="https://chzzk.naver.com/${post.channelId}" target="_blank" rel="noopener noreferrer">
        <img src="${channel?.channelImageUrl || ''}" alt="" onerror="this.style.visibility='hidden'" />
        <span class="feed-card-name">${escapeHtml(channel?.channelName || '알 수 없는 채널')}</span>
      </a>
      <span class="feed-card-time">${formatTime(post.createdAt)}</span>
    </div>
    <div class="feed-card-body">${linkifyContent(post.content)}</div>
    ${buildImageSection(post.imageUrls)}
    <div class="feed-card-meta">
      <a class="meta-comment-link" href="https://chzzk.naver.com/${post.channelId}/community/detail/${post.articleId}" target="_blank" rel="noopener noreferrer">💬 ${post.commentCount ?? 0}</a>
      <span>♥ ${post.likeCount ?? 0}</span>
    </div>
  `;
  return li;
}

// ── 피드 로딩 ──
async function loadFeed() {
  const version = ++feedVersion;
  channelOffsets = {};
  exhausted = {};
  allPosts = [];
  isLoadingMore = false;
  if (feedObserver) { feedObserver.disconnect(); feedObserver = null; }
  removeFeedEnd();

  const activeChannelIds = myChannels.filter((c) => selectedChannelIds.has(c.channelId));
  if (myChannels.length === 0 || activeChannelIds.length === 0) {
    setFeedState('empty');
    return;
  }

  setFeedState('loading');
  try {
    const ids = activeChannelIds.map((c) => c.channelId).join(',');
    const res = await fetch(`${window.BACKEND_URL}/api/feed?channelIds=${encodeURIComponent(ids)}`);
    const json = await res.json();
    if (!json.ok) throw new Error(json.error);

    if (version !== feedVersion) return;
    allPosts = json.posts ?? [];
    renderFeed(allPosts);

    // 채널별 offset 세팅 및 첫 페이지에서 이미 exhausted된 채널 표시
    const countPerChannel = {};
    allPosts.forEach((p) => { countPerChannel[p.channelId] = (countPerChannel[p.channelId] || 0) + 1; });
    activeChannelIds.forEach((c) => {
      channelOffsets[c.channelId] = PAGE_SIZE;
      if ((countPerChannel[c.channelId] ?? 0) < PAGE_SIZE) exhausted[c.channelId] = true;
    });

    if (activeChannelIds.every((c) => exhausted[c.channelId])) {
      showFeedEnd();
    } else {
      setupFeedObserver();
    }
  } catch (err) {
    setFeedState('error', err.message);
  }
}

// ── 무한 스크롤: 다음 페이지 로드 ──
async function loadMore() {
  const version = feedVersion;
  const activeChannels = myChannels.filter((c) => selectedChannelIds.has(c.channelId) && !exhausted[c.channelId]);
  if (activeChannels.length === 0 || isLoadingMore) return;

  isLoadingMore = true;
  showLoadingMore(true);

  try {
    const ids = activeChannels.map((c) => c.channelId).join(',');
    const offsets = activeChannels.map((c) => channelOffsets[c.channelId]).join(',');
    const res = await fetch(
      `${window.BACKEND_URL}/api/feed?channelIds=${encodeURIComponent(ids)}&offsets=${encodeURIComponent(offsets)}`
    );
    const json = await res.json();
    if (!json.ok) throw new Error(json.error);

    const newPosts = json.posts ?? [];
    if (version !== feedVersion) return;
    if (newPosts.length > 0) {
      const countPerChannel = {};
      newPosts.forEach((p) => { countPerChannel[p.channelId] = (countPerChannel[p.channelId] || 0) + 1; });
      activeChannels.forEach((c) => {
        channelOffsets[c.channelId] += PAGE_SIZE;
        if ((countPerChannel[c.channelId] ?? 0) < PAGE_SIZE) exhausted[c.channelId] = true;
      });
      allPosts = allPosts.concat(newPosts);
      appendPostsToFeed(newPosts);
    } else {
      activeChannels.forEach((c) => { exhausted[c.channelId] = true; });
    }

    if (myChannels.filter((c) => selectedChannelIds.has(c.channelId)).every((c) => exhausted[c.channelId])) {
      showFeedEnd();
      if (feedObserver) { feedObserver.disconnect(); feedObserver = null; }
    }
  } catch {
    showToast('더 불러오지 못했어요');
  } finally {
    isLoadingMore = false;
    showLoadingMore(false);
  }
}

function setupFeedObserver() {
  const sentinel = document.getElementById('feed-sentinel');
  feedObserver = new IntersectionObserver((entries) => {
    if (entries[0].isIntersecting && !isLoadingMore) loadMore();
  }, { rootMargin: '300px' });
  feedObserver.observe(sentinel);
}

function setFeedState(state, errorMsg) {
  els.feedEmpty.hidden = state !== 'empty';
  els.feedLoading.hidden = state !== 'loading';
  els.feedError.hidden = state !== 'error';
  els.feedList.hidden = state !== 'list';
  if (state === 'error') els.feedErrorMsg.textContent = errorMsg || '잠시 후 다시 시도해주세요.';
}

function renderFeed(posts) {
  if (!posts || posts.length === 0) {
    setFeedState('empty');
    els.feedEmpty.querySelector('.feed-state-title')?.remove();
    return;
  }
  setFeedState('list');
  els.feedList.innerHTML = '';
  posts.forEach((post) => els.feedList.appendChild(buildFeedCard(post)));
}

function appendPostsToFeed(posts) {
  posts.forEach((post) => els.feedList.appendChild(buildFeedCard(post)));
}

function showLoadingMore(show) {
  const existing = document.getElementById('feed-loading-more');
  if (show && !existing) {
    const div = document.createElement('div');
    div.id = 'feed-loading-more';
    div.className = 'feed-loading-more';
    div.innerHTML = '<div class="spinner"></div>';
    document.getElementById('feed-sentinel').before(div);
  } else if (!show && existing) {
    existing.remove();
  }
}

function showFeedEnd() {
  removeFeedEnd();
  const el = document.createElement('li');
  el.id = 'feed-end';
  el.className = 'feed-end';
  el.textContent = '모든 게시글을 불러왔어요';
  els.feedList.appendChild(el);
}

function removeFeedEnd() {
  document.getElementById('feed-end')?.remove();
}

// ── 확장프로그램 연동: 팔로우 목록 일괄 가져오기 ──
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

// ── 라이트박스 ──
const lightbox = document.getElementById('img-lightbox');
const lightboxImg = document.getElementById('img-lightbox-img');

els.feedList.addEventListener('click', (e) => {
  const img = e.target.closest('.feed-card-images img');
  if (!img) return;
  lightboxImg.src = img.src;
  lightbox.hidden = false;
});

lightbox.addEventListener('click', () => {
  lightbox.hidden = true;
  lightboxImg.src = '';
});

// ── 유틸 ──
function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}
function linkifyContent(text) {
  return String(text ?? '').split(/(https?:\/\/[^\s]+)/g).map((part, i) =>
    i % 2 === 1
      ? `<a class="post-link" href="${escapeHtml(part)}" target="_blank" rel="noopener noreferrer">${escapeHtml(part)}</a>`
      : escapeHtml(part)
  ).join('');
}
function formatCount(n) {
  if (n >= 10000) return `${(n / 10000).toFixed(1)}만`;
  return String(n ?? 0);
}
function formatTime(iso) {
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
renderMyChannels();
loadFeed();
connectExtension();
