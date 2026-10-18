import test from 'node:test';
import assert from 'node:assert';
import { handleTencentBatchRequest } from '../../apis/tencent-batch-api.js';

function segments(count) {
  return Array.from({ length: count }, (_, index) => ({
    type: 'qq',
    url: `https://dm.video.qq.com/barrage/segment/testvid/t/v1/${index * 30000}/${(index + 1) * 30000}`,
  }));
}

test('tencent batch 仅接受 POST 和合法腾讯分片', async () => {
  const getResponse = await handleTencentBatchRequest(new Request('https://internal.test/', { method: 'GET' }));
  assert.equal(getResponse.status, 405);

  const invalidResponse = await handleTencentBatchRequest(new Request('https://internal.test/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ segments: [{ type: 'qq', url: 'https://example.com/private' }] }),
  }));
  assert.equal(invalidResponse.status, 400);

  const oversizedSegmentResponse = await handleTencentBatchRequest(new Request('https://internal.test/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      segments: [{ type: 'qq', url: 'https://dm.video.qq.com/barrage/segment/testvid/t/v1/0/300000' }],
    }),
  }));
  assert.equal(oversizedSegmentResponse.status, 400);

  const oversizedResponse = await handleTencentBatchRequest(new Request('https://internal.test/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ segments: segments(41) }),
  }));
  assert.equal(oversizedResponse.status, 400);
});

test('tencent batch 最多 6 路并发并完整保留分片顺序', async () => {
  let active = 0;
  let maxActive = 0;
  const requestSegments = segments(17);
  const response = await handleTencentBatchRequest(new Request('https://internal.test/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ segments: requestSegments }),
  }), {
    fetchImpl: async input => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise(resolve => setTimeout(resolve, 2));
      active--;
      return new Response(JSON.stringify({ barrage_list: [{ content: String(input) }] }), {
        headers: { 'Content-Type': 'application/json' },
      });
    },
  });

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.success, true);
  assert.ok(maxActive <= 6, `最大并发应不超过 6，实际为 ${maxActive}`);
  assert.deepEqual(body.comments.map(item => item.content), requestSegments.map(item => item.url));
});

test('tencent batch 重试后仍失败会返回 502，不返回部分内容', async () => {
  const response = await handleTencentBatchRequest(new Request('https://internal.test/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ segments: segments(2) }),
  }), {
    fetchImpl: async input => {
      if (String(input).endsWith('/30000/60000')) return new Response('bad gateway', { status: 502 });
      return Response.json({ barrage_list: [{ content: 'ok' }] });
    },
  });

  assert.equal(response.status, 502);
  const body = await response.json();
  assert.equal(body.success, false);
  assert.equal('comments' in body, false);
});
