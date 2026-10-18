import { log } from "../utils/log-util.js";
import { convertToDanmakuJson } from "../utils/danmu-util.js";
import { extractAnimeTitle, extractYear } from "../utils/common-util.js";

// =====================
// 源基类
// =====================

export default class BaseSource {

  constructor() {
    // 构造函数，初始化通用配置
  }

  // 搜索关键字
  async search(keyword) {
    throw new Error("Method 'search' must be implemented");
  }

  // 获取剧集详情
  async getEpisodes(id) {
    throw new Error("Method 'Episodes' must be implemented");
  }

  // 处理animes结果，用数据模型Anime存储
  async handleAnimes(sourceAnimes, queryTitle, curAnimes, extra = null, detailStore = null) {
    throw new Error("Method 'handleAnimes' must be implemented");
  }

  // 获取某集的弹幕
  async getEpisodeDanmu(id) {
    throw new Error("Method 'getEpisodeDanmu' must be implemented");
  }

  // 获取某集的弹幕分片列表
  async getEpisodeDanmuSegments(id) {
    throw new Error("Method 'getEpisodeDanmuSegments' must be implemented");
  }

  // 获取某集的分片弹幕
  async getEpisodeSegmentDanmu(segment) {
    throw new Error("Method 'getEpisodeSegmentDanmu' must be implemented");
  }

  // 格式化弹幕
  formatComments(comments) {
    throw new Error("Method 'formatComments' must be implemented");
  }

  // Provider payloads occasionally contain one malformed row. Formatting the
  // whole array in one map() used to make that single row reject the complete
  // Infuse track. Retry row-by-row on formatter failure and keep valid rows.
  formatCommentsSafely(comments) {
    try {
      const formatted = this.formatComments(comments);
      return formatted ?? [];
    } catch (error) {
      log('warn', `[system] [base] 批量格式化失败，改为逐条跳过坏数据: ${error.message}`);
    }

    if (!Array.isArray(comments)) return [];
    const formatted = [];
    for (const item of comments) {
      try {
        const single = [item];
        for (const key of Object.keys(comments)) {
          if (!/^\d+$/.test(key)) single[key] = comments[key];
        }
        const rows = this.formatComments(single);
        if (Array.isArray(rows)) formatted.push(...rows.filter(Boolean));
      } catch (error) {
        log('warn', `[system] [base] 已跳过无法格式化的弹幕: ${error.message}`);
      }
    }
    return formatted;
  }

  // 获取弹幕流水线方法(获取某集弹幕 -> 格式化弹幕 -> 弹幕处理，如去重/屏蔽字等)
  async getComments(id, sourceName, segmentFlag=false, progressCallback=null) {
    if (segmentFlag) {
      if(progressCallback) await progressCallback(5, `开始获取弹幕${sourceName}弹幕分片列表`);
      log("info", `[system] [base] 开始获取弹幕${sourceName}弹幕分片列表`);
      return await this.getEpisodeDanmuSegments(id);
    }
    if(progressCallback) await progressCallback(5, `开始获取弹幕${sourceName}弹幕`);
    log("info", `[system] [base] 开始获取弹幕${sourceName}弹幕`);
    const raw = await this.getEpisodeDanmu(id);
    if(progressCallback) await progressCallback(85,`原始弹幕 ${raw.length} 条，正在规范化`);
    log("info", `[system] [base] 原始弹幕 ${raw.length} 条，正在规范化`);
    const formatted = this.formatCommentsSafely(raw);
    if(progressCallback) await progressCallback(100,`弹幕处理完成，共 ${formatted.length} 条`);
    log("info", `[system] [base] 弹幕处理完成，共 ${formatted.length} 条`);
    return convertToDanmakuJson(formatted, sourceName);
  }

  // 获取分片弹幕流水线方法(获取某集分片弹幕 -> 格式化弹幕 -> 弹幕处理，如去重/屏蔽字等)
  async getSegmentComments(segment, progressCallback=null) {
    if(progressCallback) await progressCallback(5, `开始获取分片弹幕${segment.type}弹幕`);
    log("info", `[system] [base] 开始获取分片弹幕${segment.type}弹幕`);
    const raw = await this.getEpisodeSegmentDanmu(segment);
    if(progressCallback) await progressCallback(85,`原始分片弹幕 ${raw.length} 条，正在规范化`);
    log("info", `[system] [base] 原始分片弹幕 ${raw.length} 条，正在规范化`);
    const formatted = this.formatCommentsSafely(raw);
    if(progressCallback) await progressCallback(100,`分片弹幕处理完成，共 ${formatted.length} 条`);
    log("info", `[system] [base] 分片弹幕处理完成，共 ${formatted.length} 条`);
    return convertToDanmakuJson(formatted, segment.type);
  }

  // 按年份降序排序并添加到curAnimes
  sortAndPushAnimesByYear(processedAnimes, curAnimes) {
    processedAnimes
      .filter(anime => anime !== null)
      .sort((a, b) => {
        const yearA = extractYear(a.animeTitle);
        const yearB = extractYear(b.animeTitle);

        // 如果都有年份，按年份降序排列
        if (yearA !== null && yearA !== undefined && yearB !== null && yearB !== undefined) {
          if (yearB !== yearA) {
            return yearB - yearA;
          }
          // 年份相同时，按 title 字数升序排列（字数少的在前）
          const titleA = extractAnimeTitle(a.animeTitle);
          const titleB = extractAnimeTitle(b.animeTitle);
          return titleA.length - titleB.length;
        }
        // 如果只有a有年份，a排在前面
        if ((yearA !== null && yearA !== undefined) && (yearB === null || yearB === undefined)) {
          return -1;
        }
        // 如果只有b有年份，b排在前面
        if ((yearA === null || yearA === undefined) && (yearB !== null && yearB !== undefined)) {
          return 1;
        }
        // 如果都没有年份，保持原顺序
        return 0;
      })
      .forEach(anime => {
        // 检查 curAnimes 中是否已存在相同 animeId 的动漫
        const existingIndex = curAnimes.findIndex(a => a.animeId === anime.animeId);
        if (existingIndex === -1) {
          // 不存在则添加
          curAnimes.push(anime);
        }
        // 如果已存在则跳过，避免重复
      });
  }
}
