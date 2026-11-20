/**
 * 用户可见数字的格式化。
 *
 * 规则来源：docs/ui-copy.md 第 6 节。界面上一律用「字」不用「字符」，
 * 4 位以上加半角逗号千分位，只显示整数；耗时一律转秒，毫秒只出现在排障信息里。
 */

const GROUP_SEPARATOR = ",";

/** 整数加千分位：1234 → "1,234"。非有限值或负数按 0 处理。 */
export function formatCount(value: number): string {
  const safe = Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
  return String(safe).replace(/\B(?=(\d{3})+(?!\d))/g, GROUP_SEPARATOR);
}

/** 「1,234 字」。中文与数字之间保留一个半角空格。 */
export function formatCharacterCount(value: number): string {
  return `${formatCount(value)} 字`;
}

/**
 * 毫秒转人读的秒：< 1 秒给一位小数，1–59 秒给整数，≥ 60 秒拆成分秒。
 * 只在导出文件与面向用户的说明里用；排障信息保留原始毫秒。
 */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "0 秒";
  if (ms < 100) return "不到 0.1 秒";
  if (ms < 1000) return `${(ms / 1000).toFixed(1)} 秒`;

  const totalSeconds = Math.round(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds} 秒`;

  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) return `${minutes} 分 ${String(seconds).padStart(2, "0")} 秒`;

  const hours = Math.floor(minutes / 60);
  return `${hours} 小时 ${String(minutes % 60).padStart(2, "0")} 分`;
}
