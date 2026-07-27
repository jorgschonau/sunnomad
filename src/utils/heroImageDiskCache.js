// NOTE: must be the /legacy entry — in expo-file-system@19 (SDK 54) the main
// entry only exports stubs for getInfoAsync/downloadAsync that throw at runtime.
import * as FileSystem from 'expo-file-system/legacy';

const CACHE_DIR = `${FileSystem.cacheDirectory}hero-images/`;
const inflight = new Map();

function cacheFileName(url) {
  const base = url.split('/').pop()?.split('?')[0] || 'hero.webp';
  let hash = 0;
  for (let i = 0; i < url.length; i++) {
    hash = ((hash << 5) - hash + url.charCodeAt(i)) | 0;
  }
  return `${Math.abs(hash)}_${base}`;
}

let dirReady = false;

async function ensureCacheDir() {
  if (dirReady) return;
  const info = await FileSystem.getInfoAsync(CACHE_DIR);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(CACHE_DIR, { intermediates: true });
  }
  dirReady = true;
}

// Cache grows with every browsed place; the OS only clears cacheDirectory
// under storage pressure. Evict oldest files past the cap, once per session.
// ~1000 × 80–100 KB ≈ 100 MB; covers long browse sessions, harmless for the OS
const MAX_CACHE_FILES = 1000;
let evictionDone = false;

async function evictOldFilesOnce() {
  if (evictionDone) return;
  evictionDone = true;
  try {
    const names = await FileSystem.readDirectoryAsync(CACHE_DIR);
    if (names.length <= MAX_CACHE_FILES) return;
    const infos = await Promise.all(
      names.map(async (name) => {
        const info = await FileSystem.getInfoAsync(CACHE_DIR + name);
        return { name, mtime: info.modificationTime ?? 0 };
      })
    );
    infos.sort((a, b) => a.mtime - b.mtime);
    const excess = infos.slice(0, infos.length - MAX_CACHE_FILES);
    await Promise.all(
      excess.map((f) => FileSystem.deleteAsync(CACHE_DIR + f.name, { idempotent: true }))
    );
    if (__DEV__) console.log(`[heroDiskCache] evicted ${excess.length} old files`);
  } catch (err) {
    if (__DEV__) console.warn('[heroDiskCache] eviction failed:', err?.message);
  }
}

/** Download remote hero to app cache dir; return file:// URI. Falls back to remote URL. */
export async function getHeroImageUri(url) {
  if (!url?.startsWith('http')) return url;

  try {
    await ensureCacheDir();
    const localUri = CACHE_DIR + cacheFileName(url);
    const info = await FileSystem.getInfoAsync(localUri);
    if (info.exists) return localUri;

    if (inflight.has(url)) return inflight.get(url);

    const task = FileSystem.downloadAsync(url, localUri)
      .then(({ uri }) => {
        void evictOldFilesOnce();
        return uri;
      })
      .catch((err) => {
        if (__DEV__) console.warn('[heroDiskCache] download failed:', err?.message);
        return url;
      })
      .finally(() => inflight.delete(url));

    inflight.set(url, task);
    return task;
  } catch (err) {
    if (__DEV__) console.warn('[heroDiskCache] unavailable:', err?.message);
    return url;
  }
}

export function prefetchHeroImageUris(urls, { excludeUrl = null } = {}) {
  for (const url of urls || []) {
    if (!url?.startsWith('http') || url === excludeUrl) continue;
    getHeroImageUri(url).catch(() => {});
  }
}
