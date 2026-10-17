# dm.yiya.love / Infuse Danmaku compatibility notes

Last reviewed: 2026-10-18

## Observed client behavior

- Infuse beta `8.5.5793` requests the DanDanPlay-compatible v2 endpoints with
  `User-Agent: Infuse/... CFNetwork/...`.
- For a TMDB-only single-episode lookup it requests
  `/api/v2/search/episodes?v2=true&tmdbId=...&tmdbIdType=0&episode=...`.
- It then requests `/api/v2/comment/<episodeId>?withRelated=true&chConvert=0`.
- In the supplied HAR both custom requests were canceled by Infuse at roughly
  10 seconds with no HTTP status/body. The official endpoint returned quickly.

## Root causes found

1. The custom search pipeline waited for every configured source. A slow
   `hanjutv` retry kept the response open after the useful Douban/Youku result
   was already available.
2. The Youku comment path performed several setup requests, attempted the
   `mmstat` cna request, and retried segment POSTs. On Cloudflare this could
   exceed the same client-side timeout before the non-empty `m` comments were
   serialized.
3. The Youku parser itself was already extracting正文 into both `content` and
   `m`; the empty Infuse view was primarily a response-time failure, not an
   empty-comment conversion failure.

## Compatibility decisions

- `searchEpisodes` adds an internal `episodeLookup=1` marker to the internal
  `/search/anime` call. Only this single-episode path bounds each source to
  6.5 seconds and keeps results from sources that finished; ordinary searches
  still wait for the full configured source set.
- In edge/serverless runtimes, Youku uses a local cna immediately, bounds each
  upstream request to 4 seconds, and disables the extra retry. The local cna is
  only a client identifier and does not change the comment payload.
- The token request no longer loops on an empty response. It fails closed and
  returns an empty segment list when the upstream token is unavailable.

## Response verification

The deployed endpoint was observed to return JSON comments with non-empty `m`
values such as `这一撞很实心` and `哈哈哈哈哈哈哈哈哈`. The emitted `p` is
the existing DanDanPlay-compatible four-field form and should be revisited only
if a post-fix Infuse capture shows a response arriving before timeout but still
not rendering text.
