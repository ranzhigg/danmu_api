import test from 'node:test';
import assert from 'node:assert/strict';

import { Globals } from '../../configs/globals.js';
import { convertToDanmakuJson } from '../../utils/danmu-util.js';
import BaseSource from '../../sources/base.js';
import TencentSource from '../../sources/tencent.js';
import IqiyiSource from '../../sources/iqiyi.js';
import MangoSource from '../../sources/mango.js';
import BilibiliSource from '../../sources/bilibili.js';
import MiguSource from '../../sources/migu.js';
import YoukuSource from '../../sources/youku.js';
import SohuSource from '../../sources/sohu.js';
import LeshiSource from '../../sources/leshi.js';
import XiguaSource from '../../sources/xigua.js';
import MaiduiduiSource from '../../sources/maiduidui.js';
import AiyifanSource from '../../sources/aiyifan.js';
import HongguoSource from '../../sources/hongguo.js';
import RenrenSource from '../../sources/renren.js';
import HanjutvSource from '../../sources/hanjutv.js';
import BahamutSource from '../../sources/bahamut.js';
import DandanSource from '../../sources/dandan.js';
import CustomSource from '../../sources/custom.js';
import AnimekoSource from '../../sources/animeko.js';

const CASES = [
  ['tencent', new TencentSource(), [{ time_offset: 1000, content: '腾讯正文' }]],
  ['iqiyi', new IqiyiSource(), [{ showTime: '1', color: 'ffffff', content: '爱奇艺正文' }]],
  ['imgo', new MangoSource(), [{ time: 1000, content: '芒果正文' }]],
  ['bilibili', new BilibiliSource(), [{ progress: 1000, mode: 1, color: 16777215, content: 'B站正文' }]],
  ['migu', new MiguSource(), [{ cid: 1, playtime: 1, textcolor: 'FFFFFF', msg: '咪咕正文' }]],
  ['youku', new YoukuSource(), [{ playat: 1000, content: '优酷正文' }]],
  ['sohu', new SohuSource(), [{ i: 1, v: 1, c: '搜狐正文' }]],
  ['leshi', new LeshiSource(), [{ id: 1, start: 1, color: 'FFFFFF', txt: '乐视正文' }]],
  ['xigua', new XiguaSource(), [{ danmaku_id: 1, offset_time: 1000, text: '西瓜正文' }]],
  ['maiduidui', new MaiduiduiSource(), [{ uuid: 1, times: 1, color: '#ffffff', content: '埋堆堆正文' }]],
  ['aiyifan', new AiyifanSource(), [{ second: 1, color: '#ffffff', contxt: '爱壹帆正文' }]],
  ['hongguo', new HongguoSource(), [{ offsetMs: 1000, text: '红果正文' }]],
  ['renren', new RenrenSource(), [{ p: '1,1,25,16777215,0,0,user,1', d: '人人正文' }]],
  ['hanjutv', new HanjutvSource(), [{ did: 1, t: 1000, tp: 1, sc: 16777215, con: '韩剧正文' }]],
  ['bahamut', new BahamutSource(), [{ sn: 1, time: 10, position: 0, color: '#ffffff', text: '巴哈正文' }]],
  ['dandan', new DandanSource(), [{ cid: 1, p: '1,1,25,16777215,0,0,user,1', m: '弹弹正文' }]],
  ['custom', new CustomSource(), [{ cid: 1, p: '1,1,25,16777215,0,0,user,1', m: '自定义正文' }]],
  ['animeko', new AnimekoSource(), [{ id: 1, danmakuInfo: { playTime: 1000, location: 'NORMAL', color: -1, text: 'Animeko正文' } }]],
];

test('all searchable comment providers normalize to an Infuse-visible row', () => {
  Globals.init({ BLOCKED_WORDS: '', GROUP_MINUTE: '0', DANMU_LIMIT: '0', CONVERT_COLOR: 'default' });

  for (const [source, adapter, raw] of CASES) {
    const formatted = adapter.formatCommentsSafely(raw);
    const output = convertToDanmakuJson(formatted, source);
    assert.equal(output.length, 1, `${source} should keep one visible row`);
    assert.ok(output[0].m.trim(), `${source} should expose non-empty m`);
    assert.ok(Number.isFinite(Number(output[0].p.split(',')[0])), `${source} should expose finite time`);
  }
});

test('one malformed provider row no longer drops the complete Infuse track', () => {
  class FragileSource extends BaseSource {
    formatComments(comments) {
      return comments.map(item => ({
        p: `${item.time.toFixed(2)},1,16777215,[fragile]`,
        m: item.text,
      }));
    }
  }

  const formatted = new FragileSource().formatCommentsSafely([
    { time: null, text: '坏数据' },
    { time: 2, text: '可见正文' },
  ]);
  const output = convertToDanmakuJson(formatted, 'fragile');
  assert.deepEqual(output.map(item => item.m), ['可见正文']);
});
