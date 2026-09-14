import { describe, expect, it } from 'vitest';
import { formatDate, formatDateTime, formatMonthDayTime } from './datetime';

// 2026-07-30T12:32:23Z = 北京时间 2026/07/30 20:32:23
const TS = '2026-07-30T12:32:23.000Z';
// 2026-07-30T23:10:00Z = 北京时间 2026/07/31 07:10 —— 跨日，用来抓「按 UTC 算日期」的回归
const TS_CROSS_DAY = '2026-07-30T23:10:00.000Z';

describe('后台时间显示固定 UTC+8', () => {
  it('formatDateTime 输出北京时间', () => {
    expect(formatDateTime(TS)).toBe('2026/07/30 20:32:23');
  });

  it('跨 UTC 日的时间戳按 +8 归到次日', () => {
    expect(formatDateTime(TS_CROSS_DAY)).toBe('2026/07/31 07:10:00');
    expect(formatDate(TS_CROSS_DAY)).toBe('2026/07/31');
  });

  it('formatMonthDayTime 输出紧凑月日时分', () => {
    expect(formatMonthDayTime(TS)).toBe('07/30 20:32');
  });

  it('接受 Date 与毫秒数，结果与字符串一致', () => {
    const expected = formatDateTime(TS);
    expect(formatDateTime(new Date(TS))).toBe(expected);
    expect(formatDateTime(Date.parse(TS))).toBe(expected);
  });

  it('空值走 fallback，非法值原样返回', () => {
    expect(formatDateTime(undefined)).toBe('-');
    expect(formatDateTime(null)).toBe('-');
    expect(formatDateTime('')).toBe('-');
    expect(formatDateTime(undefined, '暂无')).toBe('暂无');
    expect(formatDateTime('not-a-date')).toBe('not-a-date');
  });
});
