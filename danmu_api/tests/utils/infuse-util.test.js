import test from 'node:test';
import assert from 'node:assert/strict';

import {
  assignInfuseEpisodeIds,
  clearInfuseEpisodeMappingsForTest,
  decodeInfuseEpisodeId,
  getInfuseEpisodeMapping,
  isInfuseEpisodeId,
  rememberInfuseEpisodeMapping,
} from '../../utils/infuse-util.js';

test('Infuse episode IDs are safe, reversible and independent of candidate order', () => {
  const candidates = [
    { source: 'youku', title: '【youku】 第5集', url: 'https://v.youku.com/v_show/id_a.html' },
    { source: 'tencent', title: '【qq】 第5集', url: 'https://v.qq.com/x/cover/a/b.html' },
  ];
  const context = { tmdbId: 300146, mediaType: 'tv', episode: 5 };
  const ids = assignInfuseEpisodeIds(candidates, context);
  const reversedIds = assignInfuseEpisodeIds([...candidates].reverse(), context).reverse();

  assert.deepEqual(ids, reversedIds);
  assert.equal(new Set(ids).size, 2);
  for (const id of ids) {
    assert.equal(Number.isSafeInteger(id), true);
    assert.equal(isInfuseEpisodeId(id), true);
  }
  assert.deepEqual(decodeInfuseEpisodeId(ids[0]), {
    id: ids[0],
    tmdbId: 300146,
    mediaType: 'tv',
    episode: 5,
    source: 'youku',
    hash: decodeInfuseEpisodeId(ids[0]).hash,
  });
});

test('Infuse episode mappings survive an isolate-local memory reset through Cache API', async () => {
  const previousCaches = globalThis.caches;
  const entries = new Map();
  globalThis.caches = {
    default: {
      async put(request, response) { entries.set(request.url, response.clone()); },
      async match(request) { return entries.get(request.url)?.clone(); },
    },
  };

  try {
    clearInfuseEpisodeMappingsForTest();
    const [id] = assignInfuseEpisodeIds([
      { source: 'iqiyi', title: '【qiyi】 第1集', url: 'https://www.iqiyi.com/v_test.html' },
    ], { tmdbId: 123456, mediaType: 'movie', episode: 1 });
    const expected = {
      id,
      url: 'https://www.iqiyi.com/v_test.html',
      title: '【qiyi】 第1集',
      animeTitle: '测试电影(2026)【电影】',
      source: 'iqiyi',
    };

    await rememberInfuseEpisodeMapping(expected);
    clearInfuseEpisodeMappingsForTest();
    assert.deepEqual(await getInfuseEpisodeMapping(id), expected);
  } finally {
    clearInfuseEpisodeMappingsForTest();
    if (previousCaches === undefined) delete globalThis.caches;
    else globalThis.caches = previousCaches;
  }
});

