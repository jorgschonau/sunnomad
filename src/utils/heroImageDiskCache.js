import * as FileSystem from 'expo-file-system';

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
      .then(({ uri }) => uri)
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
