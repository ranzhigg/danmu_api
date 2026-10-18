export const TENCENT_SEGMENT_BATCH_SIZE = 40;
export const TENCENT_SEGMENT_CONCURRENCY = 6;

const TENCENT_SEGMENT_PATH = /^\/barrage\/segment\/[A-Za-z0-9_-]+\/t\/v1\/(\d+)\/(\d+)$/;

export function isValidTencentSegment(segment) {
  if (!segment || segment.type !== 'qq' || typeof segment.url !== 'string') return false;

  try {
    const url = new URL(segment.url);
    const match = url.pathname.match(TENCENT_SEGMENT_PATH);
    if (url.protocol !== 'https:' || url.hostname !== 'dm.video.qq.com' || !match) return false;

    const start = Number(match[1]);
    const end = Number(match[2]);
    return Number.isSafeInteger(start) && Number.isSafeInteger(end)
      && start >= 0 && end - start === 30000;
  } catch {
    return false;
  }
}

export async function mapWithConcurrency(items, concurrency, mapper) {
  const values = Array.isArray(items) ? items : [];
  if (values.length === 0) return [];

  const results = new Array(values.length);
  let nextIndex = 0;
  const workerCount = Math.min(Math.max(1, Number(concurrency) || 1), values.length);

  async function worker() {
    while (true) {
      const index = nextIndex++;
      if (index >= values.length) return;
      results[index] = await mapper(values[index], index);
    }
  }

  const settled = await Promise.allSettled(Array.from({ length: workerCount }, worker));
  const failed = settled.find(result => result.status === 'rejected');
  if (failed) throw failed.reason;
  return results;
}

async function fetchWithTimeout(fetchImpl, url, timeout) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  try {
    return await fetchImpl(url, {
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function fetchTencentSegment(segment, {
  fetchImpl = globalThis.fetch,
  retries = 1,
  timeout = 10000,
} = {}) {
  if (!isValidTencentSegment(segment)) throw new Error('Invalid Tencent segment');
  if (typeof fetchImpl !== 'function') throw new Error('fetch is unavailable');

  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetchWithTimeout(fetchImpl, segment.url, timeout);
      if (!response.ok) throw new Error(`Tencent segment HTTP ${response.status}`);

      const text = await response.text();
      const data = typeof text === 'string' ? JSON.parse(text) : text;
      if (!Array.isArray(data?.barrage_list)) throw new Error('Malformed Tencent segment payload');
      return data.barrage_list;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error('Tencent segment request failed');
}

export async function fetchTencentSegmentBatch(segments, options = {}) {
  if (!Array.isArray(segments) || segments.length === 0 || segments.length > TENCENT_SEGMENT_BATCH_SIZE) {
    throw new Error(`Tencent segment batch must contain 1-${TENCENT_SEGMENT_BATCH_SIZE} items`);
  }
  if (!segments.every(isValidTencentSegment)) throw new Error('Tencent segment batch contains an invalid item');

  const concurrency = options.concurrency ?? TENCENT_SEGMENT_CONCURRENCY;
  const groups = await mapWithConcurrency(
    segments,
    concurrency,
    segment => fetchTencentSegment(segment, options),
  );
  return groups.flat();
}
