// store.js
// 가벼운 JSON 파일 기반 저장소. MVP 단계에서는 DB 설치 없이 바로 동작하고,
// 나중에 트래픽이 늘면 이 파일의 함수 시그니처만 유지한 채 Postgres 등으로 교체하면 됩니다.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, 'data');
const POSTS_FILE = path.join(DATA_DIR, 'posts.json');
const CHANNELS_FILE = path.join(DATA_DIR, 'channels.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(POSTS_FILE)) fs.writeFileSync(POSTS_FILE, '{}');
if (!fs.existsSync(CHANNELS_FILE)) fs.writeFileSync(CHANNELS_FILE, '{}');

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch {
    return {};
  }
}

function writeJson(file, data) {
  // 동시 쓰기 충돌을 피하려고 임시 파일에 쓰고 교체합니다.
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

// ── 채널별 게시글 캐시 ──
// 구조: { [channelId]: { fetchedAt: number, posts: Post[] } }
export function getCachedPosts(channelId) {
  const all = readJson(POSTS_FILE);
  return all[channelId] ?? null;
}

export function setCachedPosts(channelId, posts) {
  const all = readJson(POSTS_FILE);
  all[channelId] = { fetchedAt: Date.now(), posts };
  writeJson(POSTS_FILE, all);
}

// ── 채널 메타 캐시 (검색 결과 등에서 본 채널 정보 보관) ──
export function upsertChannel(channel) {
  const all = readJson(CHANNELS_FILE);
  all[channel.channelId] = { ...all[channel.channelId], ...channel, updatedAt: Date.now() };
  writeJson(CHANNELS_FILE, all);
}

export function getChannel(channelId) {
  const all = readJson(CHANNELS_FILE);
  return all[channelId] ?? null;
}
