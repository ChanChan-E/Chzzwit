// chzzkApi.js
// 치지직의 "비로그인으로도 보이는" 공개 API들을 서버에서 직접 호출합니다.
// 이 요청들은 사용자 로그인이 필요 없으므로 확장프로그램 없이도 동작합니다.

const API_BASE = 'https://api.chzzk.naver.com/service/v1';

async function getJson(url) {
  const res = await fetch(url, {
    headers: {
      // 일부 엔드포인트는 일반 브라우저 UA가 없으면 막힐 수 있어 명시적으로 지정합니다.
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
    },
  });
  if (!res.ok) throw new Error(`치지직 API 오류: HTTP ${res.status} (${url})`);
  return res.json();
}

// 채널 검색 (사이드바의 "채널 검색/추가"에서 사용, 로그인 불필요)
export async function searchChannels(keyword) {
  const url = `${API_BASE}/search/channels?keyword=${encodeURIComponent(keyword)}&size=15`;
  const json = await getJson(url);
  return (json?.content?.data ?? []).map((item) => {
    const ch = item.channel;
    return {
      channelId: ch.channelId,
      channelName: ch.channelName,
      channelImageUrl: ch.channelImageUrl ?? '',
      followerCount: ch.followerCount ?? 0,
      verifiedMark: ch.verifiedMark ?? false,
    };
  });
}

// 채널 기본 정보 (검색 없이 channelId만으로 추가할 때 등에 사용)
export async function getChannelInfo(channelId) {
  const url = `${API_BASE}/channels/${channelId}`;
  const json = await getJson(url);
  const c = json?.content;
  if (!c) return null;
  return {
    channelId: c.channelId,
    channelName: c.channelName,
    channelImageUrl: c.channelImageUrl ?? '',
    followerCount: c.followerCount ?? 0,
    openLive: c.openLive ?? false,
  };
}

// ──────────────────────────────────────────────────────────
// 커뮤니티 게시글 API
// 치지직의 채널 게시글은 내부적으로 "채널에 달린 루트 댓글"로 모델링되어 있습니다.
//  - type: CHANNEL_POST, id: {channelId} 로 호출
//  - parentCommentId === 0 인 항목이 게시글 본문, 그 외는 댓글/답글
// ──────────────────────────────────────────────────────────
const COMMENT_API_BASE = 'https://apis.naver.com/nng_main/nng_comment_api/v1';
const COMMENT_HEADERS = {
  'front-client-platform-type': 'PC',
  'front-client-product-type': 'web',
  Accept: 'application/json, text/plain, */*',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
};

export async function fetchCommunityPosts(channelId, { limit = 10, offset = 0 } = {}) {
  const url = `${COMMENT_API_BASE}/type/CHANNEL_POST/id/${channelId}/comments?limit=${limit}&offset=${offset}&orderType=DESC&pagingType=PAGE`;

  try {
    const res = await fetch(url, {
      headers: {
        ...COMMENT_HEADERS,
        Origin: 'https://chzzk.naver.com',
        Referer: `https://chzzk.naver.com/${channelId}/community`,
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();

    const list = json?.content?.comments?.data ?? [];
    return list
      .map((item) => item.comment)
      .filter((c) => c && c.parentCommentId === 0 && !c.deleted)
      .map((c) => mapPost(c, channelId));
  } catch (err) {
    console.warn(`[fetchCommunityPosts] ${channelId} 실패: ${err.message}`);
    return [];
  }
}

function mapPost(c, channelId) {
  return {
    articleId: String(c.commentId),
    channelId,
    content: c.content ?? '',
    imageUrls: (c.attaches ?? [])
      .filter((a) => a.attachType === 'PHOTO')
      .map((a) => a.attachValue ?? '')
      .filter(Boolean),
    createdAt: parseChzzkDate(c.createdDate),
    commentCount: c.childObjectCount ?? 0,
    likeCount: c.likeCount ?? 0,
    authorName: c.user?.userNickname ?? '',
    authorImageUrl: c.user?.profileImageUrl ?? '',
  };
}

export async function fetchChannelVods(channelId, { page = 0, size = 12 } = {}) {
  const url = `${API_BASE}/channels/${channelId}/videos?page=${page}&size=${size}`;
  try {
    const json = await getJson(url);
    const list = json?.content?.data ?? [];
    return list.map((v) => mapVod(v, channelId));
  } catch (err) {
    console.warn(`[fetchChannelVods] ${channelId} 실패: ${err.message}`);
    return [];
  }
}

function mapVod(v, channelId) {
  return {
    videoNo: String(v.videoNo ?? ''),
    channelId,
    title: v.videoTitle ?? '',
    thumbnailImageUrl: v.thumbnailImageUrl ?? '',
    duration: v.duration ?? 0,
    category: v.videoCategoryValue ?? v.categoryValue ?? v.liveCategoryValue ?? v.gameName ?? '',
    publishDateAt: v.publishDateAt ?? null,
    readCount: v.readCount ?? 0,
    tags: Array.isArray(v.tags) ? v.tags : [],
  };
}

// createdDate 형식: "20260622035800" (YYYYMMDDHHmmss, 로컬시간 추정) → ISO 문자열로 변환
function parseChzzkDate(raw) {
  if (!raw || raw.length < 14) return null;
  const y = raw.slice(0, 4), mo = raw.slice(4, 6), d = raw.slice(6, 8);
  const h = raw.slice(8, 10), mi = raw.slice(10, 12), s = raw.slice(12, 14);
  // 치지직 서버 시간은 KST(UTC+9) 기준으로 추정 → ISO에 +09:00 오프셋 명시
  return `${y}-${mo}-${d}T${h}:${mi}:${s}+09:00`;
}
