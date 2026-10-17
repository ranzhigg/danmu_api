// 弹弹play 兼容接口：标题/季集解析、匹配与检索 URL
// 由原单文件测试 worker.test.js 机械拆分而来，用例名与断言未做改动。

import dotenv from 'dotenv';
dotenv.config();

import test from 'node:test';
import assert from 'node:assert';
import { extractTitleSeasonEpisode, buildSearchAnimeUrl, searchEpisodes, matchSeason, matchAniAndEp, fallbackMatchAniAndEp } from '../../apis/dandan-api.js';
import { Globals } from '../../configs/globals.js';
import { normalizeTitleForMatch } from '../../utils/common-util.js';
import { getEdgeEpisodeMapping } from '../../utils/cache-util.js';
import { urlPrefix } from '../helpers/context.js';

test('buildSearchAnimeUrl should preserve special characters in keyword', async () => {
    const searchUrl = buildSearchAnimeUrl(`${urlPrefix}/api/v2/match`, 'Love & Death', 1, 2);

    assert.equal(searchUrl.pathname, '/api/v2/search/anime');
    assert.equal(searchUrl.searchParams.get('keyword'), 'Love & Death');
    assert.equal(searchUrl.searchParams.get('season'), '1');
    assert.equal(searchUrl.searchParams.get('episode'), '2');
    assert.equal(searchUrl.searchParams.has(' Death'), false);
  });
test('buildSearchAnimeUrl should derive /search/anime from /search/episodes requests', async () => {
    const searchUrl = buildSearchAnimeUrl(`${urlPrefix}/api/v2/search/episodes?anime=Love%20%26%20Death&episode=2`, 'Love & Death');

    assert.equal(searchUrl.pathname, '/api/v2/search/anime');
    assert.equal(searchUrl.searchParams.get('keyword'), 'Love & Death');
    assert.equal(searchUrl.searchParams.has('season'), false);
    assert.equal(searchUrl.searchParams.has('episode'), false);
  });

test('searchEpisodes should accept Infuse-style tmdbId-only requests', async () => {
  Globals.init({ LOG_LEVEL: 'error' });

  const previousCaches = globalThis.caches;
  const entries = new Map();
  globalThis.caches = {
    default: {
      async put(request, response) {
        entries.set(request.url, response.clone());
      },
      async match(request) {
        const response = entries.get(request.url);
        return response ? response.clone() : undefined;
      },
    },
  };

  try {
    const requestUrl = new URL(`${urlPrefix}/api/v2/search/episodes?tmdbId=300146&tmdbIdType=0&episode=1`);
    const fakeSearchAnime = async (searchUrl, _preferAnimeId, _preferSource, detailStore) => {
      assert.equal(searchUrl.searchParams.get('keyword'), '嫁金钗');

      detailStore.set('detail', {
        animeId: 7001,
        bangumiId: '7001',
        animeTitle: '嫁金钗(2026)【电视剧】',
        type: 'tvseries',
        typeDescription: '电视剧',
        imageUrl: '',
        startDate: '2026-01-01T00:00:00.000Z',
        source: 'dandan',
        links: [
          { id: 700101, title: '第1集', url: 'https://example.com/episode-1' },
          { id: 700102, title: '第2集', url: 'https://example.com/episode-2' },
        ],
      });

      return new Response(JSON.stringify({
        success: true,
        animes: [{
          animeId: 7001,
          bangumiId: '7001',
          animeTitle: '嫁金钗(2026)【电视剧】',
          type: 'tvseries',
          typeDescription: '电视剧',
          source: 'dandan',
        }],
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    };

    const response = await searchEpisodes(
      requestUrl,
      fakeSearchAnime,
      async (tmdbId, mediaType) => {
        assert.equal(tmdbId, '300146');
        assert.equal(mediaType, 'tv');
        return { title: '嫁金钗', mediaType: 'tv' };
      },
    );
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.success, true);
    assert.equal(body.animes.length, 1);
    assert.equal(body.animes[0].animeId, 7001);
    assert.equal(body.animes[0].episodes.length, 1);
    assert.equal(body.animes[0].episodes[0].episodeId, 700101);
    assert.deepEqual(await getEdgeEpisodeMapping(700101), {
      id: '700101',
      url: 'https://example.com/episode-1',
      title: '第1集',
      animeTitle: '嫁金钗(2026)【电视剧】',
    });
  } finally {
    if (previousCaches === undefined) delete globalThis.caches;
    else globalThis.caches = previousCaches;
  }
});

test('searchEpisodes should treat TMDB movie requests as single-item media across source categories', async () => {
  const previousCaches = globalThis.caches;
  const entries = new Map();
  globalThis.caches = {
    default: {
      async put(request, response) { entries.set(request.url, response.clone()); },
      async match(request) { return entries.get(request.url)?.clone(); },
    },
  };

  try {
    for (const [index, typeDescription] of ['纪录片', '综艺', '动漫'].entries()) {
      Globals.init({ LOG_LEVEL: 'error' });
      const animeId = 8100 + index;
      const detail = {
        animeId,
        bangumiId: String(animeId),
        animeTitle: `单集测试${index}(2026)【${typeDescription}】`,
        type: typeDescription,
        typeDescription,
        imageUrl: '',
        startDate: '2026-01-01T00:00:00.000Z',
        source: 'test',
        links: [{ id: animeId * 10, title: '【测试源】 正片', url: `https://example.com/${animeId}` }],
      };

      const requestUrl = new URL(`${urlPrefix}/api/v2/search/episodes?tmdbId=${9000 + index}&tmdbIdType=1&episode=1`);
      const response = await searchEpisodes(
        requestUrl,
        async (_searchUrl, _preferAnimeId, _preferSource, detailStore) => {
          detailStore.set(String(animeId), detail);
          return new Response(JSON.stringify({
            success: true,
            animes: [{
              animeId,
              bangumiId: String(animeId),
              animeTitle: detail.animeTitle,
              type: typeDescription,
              typeDescription,
              source: 'test',
            }],
          }), { status: 200, headers: { 'content-type': 'application/json' } });
        },
        async () => ({ title: `单集测试${index}`, year: 2026, mediaType: 'movie' }),
      );
      const body = await response.json();

      assert.equal(response.status, 200);
      assert.equal(body.animes.length, 1, `${typeDescription} 应保留单集候选`);
      assert.equal(body.animes[0].typeDescription, typeDescription);
      assert.equal(body.animes[0].episodes.length, 1);
    }
  } finally {
    if (previousCaches === undefined) delete globalThis.caches;
    else globalThis.caches = previousCaches;
  }
});

test('searchEpisodes should use direct sources when the configured movie sources only return editorial videos', async () => {
  Globals.init({ LOG_LEVEL: 'error' });
  const previousCaches = globalThis.caches;
  const entries = new Map();
  globalThis.caches = {
    default: {
      async put(request, response) { entries.set(request.url, response.clone()); },
      async match(request) { return entries.get(request.url)?.clone(); },
    },
  };

  try {
    const calls = [];
    const noise = {
      animeId: 8201,
      bangumiId: '8201',
      animeTitle: '某电影深度解读(2026)【电影】from 360',
      type: '电影',
      typeDescription: '电影',
      source: '360',
      links: [{ id: 820101, title: '【youku】 深度解读', url: 'https://example.com/noise' }],
    };
    const feature = {
      animeId: 8202,
      bangumiId: '8202',
      animeTitle: '某电影(2026)【电影】from tencent',
      type: '电影',
      typeDescription: '电影',
      source: 'tencent',
      links: [{ id: 820201, title: '【qq】 正片', url: 'https://example.com/feature' }],
    };
    const featureFromYouku = {
      animeId: 8203,
      bangumiId: '8203',
      animeTitle: '某电影(2026)【电影】from youku',
      type: '电影',
      typeDescription: '电影',
      source: 'youku',
      links: [{ id: 820301, title: '【youku】 正片', url: 'https://example.com/feature-youku' }],
    };

    const response = await searchEpisodes(
      new URL(`${urlPrefix}/api/v2/search/episodes?tmdbId=9005&tmdbIdType=1&episode=1`),
      async (_searchUrl, _preferAnimeId, _preferSource, detailStore, _targetPlatform, _forceRefresh, sourceOrderOverride) => {
        calls.push(sourceOrderOverride || null);
        const details = sourceOrderOverride ? [feature, featureFromYouku] : [noise];
        for (const detail of details) detailStore.set(`${detail.source}:${detail.bangumiId}`, detail);
        return new Response(JSON.stringify({
          success: true,
          animes: details.map(detail => ({ ...detail, links: undefined })),
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      },
      async () => ({ title: '某电影', year: 2026, mediaType: 'movie' }),
    );
    const body = await response.json();

    assert.equal(calls.length, 2, '默认源无正片时应追加一次直连源搜索');
    assert.deepEqual(calls[0], null);
    assert.ok(calls[1].includes('tencent'));
    assert.ok(calls[1].includes('youku'));
    assert.deepEqual(body.animes.map(anime => anime.animeId), [8202, 8203]);
    assert.deepEqual(body.animes.map(anime => anime.animeTitle), [feature.animeTitle, featureFromYouku.animeTitle]);
    assert.equal(body.animes[0].episodes[0].episodeId, 820201);
    assert.equal(body.animes[1].episodes[0].episodeId, 820301);
  } finally {
    if (previousCaches === undefined) delete globalThis.caches;
    else globalThis.caches = previousCaches;
  }
});

test('searchEpisodes should retry direct sources when the first TV candidate lacks the requested episode', async () => {
  Globals.init({ LOG_LEVEL: 'error' });
  const previousCaches = globalThis.caches;
  const entries = new Map();
  globalThis.caches = {
    default: {
      async put(request, response) { entries.set(request.url, response.clone()); },
      async match(request) { return entries.get(request.url)?.clone(); },
    },
  };

  try {
    const calls = [];
    const defaultDetail = {
      animeId: 8301,
      bangumiId: '8301',
      animeTitle: '某电视剧(2026)【电视剧】from 360',
      type: 'tvseries',
      typeDescription: '电视剧',
      source: '360',
      links: [
        { id: 830101, title: '【360】 第1集', url: 'https://example.com/tv-1' },
        { id: 830102, title: '【360】 第2集', url: 'https://example.com/tv-2' },
      ],
    };
    const fallbackDetail = {
      animeId: 8302,
      bangumiId: '8302',
      animeTitle: '某电视剧(2026)【电视剧】from tencent',
      type: 'tvseries',
      typeDescription: '电视剧',
      source: 'tencent',
      links: [
        { id: 830201, title: '【qq】 第1集', url: 'https://example.com/tv-1' },
        { id: 830202, title: '【qq】 第2集', url: 'https://example.com/tv-2' },
        { id: 830203, title: '【qq】 第3集', url: 'https://example.com/tv-3' },
      ],
    };

    const response = await searchEpisodes(
      new URL(`${urlPrefix}/api/v2/search/episodes?anime=%E6%9F%90%E7%94%B5%E8%A7%86%E5%89%A7&episode=3`),
      async (_searchUrl, _preferAnimeId, _preferSource, detailStore, _targetPlatform, _forceRefresh, sourceOrderOverride) => {
        calls.push(sourceOrderOverride || null);
        const detail = sourceOrderOverride ? fallbackDetail : defaultDetail;
        detailStore.set(`${detail.source}:${detail.bangumiId}`, detail);
        return new Response(JSON.stringify({
          success: true,
          animes: [{ ...detail, links: undefined }],
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      },
    );
    const body = await response.json();

    assert.equal(calls.length, 2, '默认源没有目标集数时应追加一次直连源搜索');
    assert.deepEqual(body.animes.map(anime => anime.animeId), [8302]);
    assert.equal(body.animes[0].episodes[0].episodeId, 830203);
  } finally {
    if (previousCaches === undefined) delete globalThis.caches;
    else globalThis.caches = previousCaches;
  }
});

  // 测试标题解析
test('PARSE TitleSeasonEpisode', async () => {
    let title, season, episode;
    ({title, season, episode} = await extractTitleSeasonEpisode("生万物 S02E08"));
    assert(title === "生万物" && season == 2 && episode == 8, `Expected title === "生万物" && season == 2 && episode == 8, but got ${title} ${season} ${episode}`);

    ({title, season, episode} = await extractTitleSeasonEpisode("无忧渡.S02E08.2160p.WEB-DL.H265.DDP.5.1"));
    assert(title === "无忧渡" && season == 2 && episode == 8, `Expected title === "无忧渡" && season == 2 && episode == 8, but got ${title} ${season} ${episode}`);

    // ({title, season, episode} = await extractTitleSeasonEpisode("Blood.River.S02E08"));
    // assert(title === "暗河传" && season == 2 && episode == 8, `Expected title === "暗河传" && season == 2 && episode == 8, but got ${title} ${season} ${episode}`);

    ({title, season, episode} = await extractTitleSeasonEpisode("爱情公寓.ipartment.2009.S02E08.H.265.25fps.mkv"));
    assert(title === "爱情公寓" && season == 2 && episode == 8, `Expected title === "爱情公寓" && season == 2 && episode == 8, but got ${title} ${season} ${episode}`);

    ({title, season, episode} = await extractTitleSeasonEpisode("亲爱的X S02E08"));
    assert(title === "亲爱的X" && season == 2 && episode == 8, `Expected title === "亲爱的X" && season == 2 && episode == 8, but got ${title} ${season} ${episode}`);

    ({title, season, episode} = await extractTitleSeasonEpisode("宇宙Marry Me? S02E08"));
    assert(title === "宇宙Marry Me?" && season == 2 && episode == 8, `Expected title === "宇宙Marry Me?" && season == 2 && episode == 8, but got ${title} ${season} ${episode}`);
  });
test('season matching unifies traditional and simplified titles', () => {
  const queryTitle = '无职转生 ～到了异世界就拿出真本事～';

  // 繁体别名与简体查询词指向同一作品同一季时必须命中；季号不一致则不得命中
  assert.equal(matchSeason({ animeTitle: '無職轉生～到了異世界就拿出真本事～第三季', source: 'dandan' }, queryTitle, 3), true);
  assert.equal(matchSeason({ animeTitle: '無職轉生～到了異世界就拿出真本事～第3季', source: 'dandan' }, queryTitle, 3), true);
  assert.equal(matchSeason({ animeTitle: '無職轉生～到了異世界就拿出真本事～第三季', source: 'dandan' }, queryTitle, 2), false);

  // 季号标识插在主体名称中间时查询词不是标题前缀，不得命中
  assert.equal(matchSeason({ animeTitle: '无职转生Ⅲ ～到了异世界就拿出真本事～', source: 'dandan' }, queryTitle, 3), false);
  assert.equal(matchSeason({ animeTitle: '无职转生 第三季 ～到了异世界就拿出真本事～', source: 'dandan' }, queryTitle, 3), false);

  // 主体一致但无季号：仅第 1 季命中；有其它季号则不得命中
  assert.equal(matchSeason({ animeTitle: '無職轉生～到了異世界就拿出真本事～', source: 'dandan' }, queryTitle, 1), true);
  assert.equal(matchSeason({ animeTitle: '無職轉生～到了異世界就拿出真本事～', source: 'dandan' }, queryTitle, 3), false);
  assert.equal(matchSeason({ animeTitle: '無職轉生～到了異世界就拿出真本事 第二季', source: 'dandan' }, queryTitle, 3), false);

  // 归一化不得把不同作品视为同一作品
  assert.equal(normalizeTitleForMatch('无职英雄 技能什么的毫无用处').includes(normalizeTitleForMatch(queryTitle)), false);
  assert.equal(matchSeason({ animeTitle: '无职英雄 技能什么的毫无用处(2025)', source: 'dandan' }, queryTitle, 3), false);
});
test('movie matching unifies traditional and simplified titles', async () => {
  Globals.init({ LOG_LEVEL: 'error' });

  const buildMovie = (animeId, animeTitle) => ({
    animeId,
    bangumiId: String(animeId),
    animeTitle,
    aliases: [],
    source: 'dandan',
    startDate: '2020-01-01T00:00:00.000Z',
    links: [{ id: animeId * 10 + 1, title: '【测试源】 正片', url: `test-${animeId}-1` }]
  });

  const traditional = buildMovie(3001, '某電影(2020)【电影】');
  const withColon = buildMovie(3002, '某电影：终章(2020)【电影】');
  const different = buildMovie(3003, '另一部电影(2020)【电影】');
  const sequel = buildMovie(3004, '某电影2(2020)【电影】');
  const detailStore = new Map([[3001, traditional], [3002, withColon], [3003, different], [3004, sequel]]);

  const matchMovie = async (animes, title) => {
    const result = await matchAniAndEp(null, null, null, { animes }, title, null, null, null, null, detailStore);
    return result.resAnime ? result.resAnime.animeId : null;
  };

  // 繁简与全半角/冒号写法差异不影响电影标题相等判定
  assert.equal(await matchMovie([traditional], '某电影'), 3001);
  assert.equal(await matchMovie([withColon], '某电影: 终章'), 3002);

  // 不同作品与续作编号仍视为不同作品
  assert.equal(await matchMovie([different], '某电影'), null);
  assert.equal(await matchMovie([sequel], '某电影'), null);
});
test('fallback matching prefers the candidate of the target season', async () => {
  Globals.init({ LOG_LEVEL: 'error' });

  const buildAnime = (animeId, animeTitle, aliases = []) => ({
    animeId,
    bangumiId: String(animeId),
    animeTitle,
    aliases,
    source: 'dandan',
    startDate: '2020-01-01T00:00:00.000Z',
    links: Array.from({ length: 12 }, (_, i) => ({ id: animeId * 100 + i + 1, title: `【测试源】 第${i + 1}话`, url: `test-${animeId}-${i + 1}` }))
  });

  const secondSeason = buildAnime(2001, '某测试动画 第二季(2023)【TV动画】from dandan');
  const thirdSeason = buildAnime(2002, '某测试动画 第三季(2026)【TV动画】from dandan');
  const thirdSeasonByAlias = buildAnime(2003, '某测试动画(2026)【TV动画】from dandan', ['某测试动画 第三季']);
  const detailStore = new Map([[2001, secondSeason], [2002, thirdSeason], [2003, thirdSeasonByAlias]]);

  const matchFallback = async (animes, season) => {
    const result = await fallbackMatchAniAndEp({ animes }, null, season, 12, null, '某测试动画', null, null, null, detailStore);
    return result.resAnime ? result.resAnime.animeId : null;
  };

  // 目标季优先于候选列表顺序
  assert.equal(await matchFallback([secondSeason, thirdSeason], 3), 2002);
  assert.equal(await matchFallback([thirdSeason, secondSeason], 3), 2002);
  assert.equal(await matchFallback([secondSeason, thirdSeason], 2), 2001);

  // 季号仅出现在别名中时同样参与优先判断
  assert.equal(await matchFallback([secondSeason, thirdSeasonByAlias], 3), 2003);

  // 无同季候选或未指定季号时保持原有取值顺序
  assert.equal(await matchFallback([secondSeason], 3), 2001);
  assert.equal(await matchFallback([secondSeason, thirdSeason], null), 2001);
});
