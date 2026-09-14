/**
 * 后台统一时间显示口径：固定 UTC+8（Asia/Shanghai），不随浏览器所在时区漂移。
 *
 * 注意：这里只管「显示」。后端 costsDaily / 配额重置 / token-guard 的分日 key 用的是
 * `toISOString().slice(0,10)`，即 **UTC 日期**，与本文件无关，也不要用本文件的函数去拼那个 key。
 */

export const ADMIN_TIME_ZONE = 'Asia/Shanghai';

const DATE_TIME = new Intl.DateTimeFormat('zh-CN', {
  timeZone: ADMIN_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

const DATE_ONLY = new Intl.DateTimeFormat('zh-CN', {
  timeZone: ADMIN_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const MONTH_DAY_TIME = new Intl.DateTimeFormat('zh-CN', {
  timeZone: ADMIN_TIME_ZONE,
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

function render(fmt: Intl.DateTimeFormat, value: string | number | Date | undefined | null, fallback: string) {
  if (value === undefined || value === null || value === '') return fallback;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return typeof value === 'string' ? value : fallback;
  return fmt.format(d);
}

/** 年月日 时:分:秒（UTC+8） */
export function formatDateTime(value: string | number | Date | undefined | null, fallback = '-') {
  return render(DATE_TIME, value, fallback);
}

/** 年月日（UTC+8） */
export function formatDate(value: string | number | Date | undefined | null, fallback = '-') {
  return render(DATE_ONLY, value, fallback);
}

/** 月日 时:分（UTC+8），用于会员周期等紧凑场景 */
export function formatMonthDayTime(value: string | number | Date | undefined | null, fallback = '-') {
  return render(MONTH_DAY_TIME, value, fallback);
}
