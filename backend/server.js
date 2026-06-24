// server.js
import express from 'express';
import cors from 'cors';
import { searchChannels, getChannelInfo, fetchCommunityPosts, fetchChannelVods } from './chzzkApi.js';
import { getCachedPosts, setCachedPosts, upsertChannel, getChannel, getCachedVods, setCachedVods } from './store.js';

const app = express();
const PORT = process.env.PORT || 4000;
const POST_CACHE_TTL = 10 * 60 * 1000; // 10분 — 같은 채널을 너무 자주 두드리지 않도록 캐싱
const VOD_CACHE_TTL = 30 * 60 * 1000; // 30분

// ALLOWED_ORIGIN 환경변수 설정 시 해당 도메인만 허용, 미설정 시 전체 허용(개발용)
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN;
app.use(cors(ALLOWED_ORIGIN ? { origin: ALLOWED_ORIGIN } : {}));
app.use(express.json());

// ── 채널 검색 (사이드바 검색창) ──
app.get('/api/channels/search', async (req, res) => {
  const keyword = (req.query.keyword ?? '').trim();
  if (!keyword) return res.json({ ok: true, channels: [] });

  try {
    const channels = await searchChannels(keyword);
    channels.forEach(upsertChannel);
    res.json({ ok: true, channels });
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message });
  }
});

// ── 채널 단건 조회 (확장프로그램에서 channelId만 넘어온 경우 등) ──
app.get('/api/channels/:channelId', async (req, res) => {
  const { channelId } = req.params;
  const cached = getChannel(channelId);
  if (cached) return res.json({ ok: true, channel: cached });

  try {
    const channel = await getChannelInfo(channelId);
    if (!channel) return res.status(404).json({ ok: false, error: '채널을 찾을 수 없습니다.' });
    upsertChannel(channel);
    res.json({ ok: true, channel });
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message });
  }
});

// ── 피드 조회: 추가된 채널들의 커뮤니티 글을 모아 시간순으로 합쳐서 반환 ──
app.get('/api/feed', async (req, res) => {
  const idsParam = (req.query.channelIds ?? '').trim();
  if (!idsParam) return res.json({ ok: true, posts: [] });

  const channelIds = [...new Set(idsParam.split(',').map((s) => s.trim()).filter(Boolean))];
  const offsetsParam = (req.query.offsets ?? '').trim();
  const offsetList = offsetsParam
    ? offsetsParam.split(',').map((s) => Math.max(0, parseInt(s, 10) || 0))
    : [];

  try {
    const postsPerChannel = await fetchPooled(channelIds, offsetList);
    const merged = postsPerChannel.flat();
    merged.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    res.json({ ok: true, posts: merged });
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message });
  }
});

// 최대 CONCURRENCY개 채널을 동시에 fetch (치지직 API 과부하 방지)
const CONCURRENCY = 5;
async function fetchPooled(channelIds, offsetList) {
  const results = new Array(channelIds.length);
  let next = 0;
  async function worker() {
    while (next < channelIds.length) {
      const i = next++;
      results[i] = await getPostsWithCache(channelIds[i], offsetList[i] ?? 0);
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, channelIds.length) }, worker));
  return results;
}

async function getPostsWithCache(channelId, offset = 0) {
  if (offset === 0) {
    const cached = getCachedPosts(channelId);
    const fresh = cached && Date.now() - cached.fetchedAt < POST_CACHE_TTL;
    if (fresh) return cached.posts;
    const posts = await fetchCommunityPosts(channelId);
    setCachedPosts(channelId, posts);
    return posts;
  }
  return fetchCommunityPosts(channelId, { limit: 10, offset });
}

// ── VOD 피드 조회 ──
app.get('/api/vods', async (req, res) => {
  const idsParam = (req.query.channelIds ?? '').trim();
  if (!idsParam) return res.json({ ok: true, vods: [] });

  const channelIds = [...new Set(idsParam.split(',').map((s) => s.trim()).filter(Boolean))];
  const page = Math.max(0, parseInt(req.query.page, 10) || 0);
  const size = Math.min(50, Math.max(1, parseInt(req.query.size, 10) || 12));

  try {
    const vodsPerChannel = await fetchVodsPooled(channelIds, page, size);
    const merged = vodsPerChannel.flat();
    merged.sort((a, b) => new Date(b.publishDateAt) - new Date(a.publishDateAt));
    res.json({ ok: true, vods: merged });
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message });
  }
});

async function fetchVodsPooled(channelIds, page, size) {
  const results = new Array(channelIds.length);
  let next = 0;
  async function worker() {
    while (next < channelIds.length) {
      const i = next++;
      results[i] = await getVodsWithCache(channelIds[i], page, size);
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, channelIds.length) }, worker));
  return results;
}

async function getVodsWithCache(channelId, page, size) {
  if (page === 0) {
    const cached = getCachedVods(channelId);
    const fresh = cached && Date.now() - cached.fetchedAt < VOD_CACHE_TTL;
    if (fresh) return cached.vods;
    const vods = await fetchChannelVods(channelId, { page, size });
    setCachedVods(channelId, vods);
    return vods;
  }
  return fetchChannelVods(channelId, { page, size });
}

app.listen(PORT, () => {
  console.log(`Chzzk Feed 백엔드 실행 중 → http://localhost:${PORT}`);
});
