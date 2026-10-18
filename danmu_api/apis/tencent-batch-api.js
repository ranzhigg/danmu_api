import { fetchTencentSegmentBatch } from '../utils/tencent-segment-util.js';

const JSON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
};

function response(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

export async function handleTencentBatchRequest(request, options = {}) {
  if (request.method !== 'POST') {
    return response({ success: false, error: 'Method not allowed' }, 405);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return response({ success: false, error: 'Invalid JSON body' }, 400);
  }

  try {
    const comments = await fetchTencentSegmentBatch(body?.segments, options);
    return response({ success: true, comments });
  } catch (error) {
    const invalid = /batch must contain|invalid item|Invalid Tencent segment/.test(error.message);
    return response({ success: false, error: error.message }, invalid ? 400 : 502);
  }
}
