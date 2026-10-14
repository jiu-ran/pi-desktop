const svg = (body: string, size = 16): string =>
  `<svg viewBox="0 0 16 16" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

/** 16px 线性图标，风格对齐 JetBrains 的工具窗口图标 */
export const icons: Record<string, string> = {
  sidebar: svg('<rect x="2" y="2.5" width="12" height="11" rx="2"/><path d="M6 2.5v11"/>'),
  panel: svg('<rect x="2" y="2.5" width="12" height="11" rx="2"/><path d="M10 2.5v11"/>'),
  plus: svg('<path d="M8 3v10M3 8h10"/>'),
  attach: svg('<path d="m6 8.5 3.8-3.8a2.1 2.1 0 0 1 3 3L7.2 13.3a3.4 3.4 0 0 1-4.8-4.8l5.4-5.4a2.3 2.3 0 0 1 3.3 3.3L5.8 11.7a1.1 1.1 0 0 1-1.6-1.6l4.7-4.7"/>'),
  image: svg('<rect x="2.5" y="3" width="11" height="10" rx="1.5"/><circle cx="6" cy="6.5" r="1"/><path d="m3.5 11 3-3 2.2 2 1.5-1.5 2.3 2.5"/>', 14),
  chat: svg('<path d="M3 3.5h10a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H7l-3 2.5v-2.5H3a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1z"/>'),
  folder: svg('<path d="M2 4.5a1 1 0 0 1 1-1h3.2l1.3 1.5H13a1 1 0 0 1 1 1V12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1z"/>'),
  file: svg('<path d="M4 2.5h5l3 3V13a.5.5 0 0 1-.5.5h-7A.5.5 0 0 1 4 13z"/><path d="M9 2.5V6h3M5.8 8.2h4.4M5.8 10.5h3.2"/>', 15),
  code: svg('<path d="m6 5-3 3 3 3M10 5l3 3-3 3M9 3.5 7 12.5"/>', 15),
  json: svg('<path d="M6 3.5c-1.5 0-1.5 1.2-1.5 2.2v.8C4.5 7.3 4 8 3 8c1 0 1.5.7 1.5 1.5v.8c0 1 .1 2.2 1.5 2.2M10 3.5c1.5 0 1.5 1.2 1.5 2.2v.8c0 .8.5 1.5 1.5 1.5-1 0 1.5.7-1.5 1.5v.8c0 1-.1 2.2-1.5 2.2"/>', 15),
  archive: svg('<path d="M3 4h10v9H3zM3 4l1-1h8l1 1M6 6h4M6.5 9h3"/>', 15),
  text: svg('<path d="M3 4h10M3 8h10M3 12h7"/>', 15),
  diff: svg('<path d="M5 2.5v7M2 6h6"/><path d="M2 12.5h6"/><path d="M11 3v10"/><circle cx="11" cy="3" r="1.2"/><circle cx="11" cy="13" r="1.2"/>'),
  terminal: svg('<rect x="2" y="3" width="12" height="10" rx="1.5"/><path d="M4.5 6.5 6.5 8l-2 1.5M8 10h3"/>'),
  events: svg('<path d="M2 8h2.5l1.5-4 2.5 8 1.5-4H14"/>'),
  puzzle: svg('<path d="M6 2.5h4v2a1 1 0 1 0 2 0v-.5h1.5V8H12a1 1 0 1 0 0 2h1.5v3.5H2.5V10H4a1 1 0 1 0 0-2H2.5V4H6"/>'),
  gear: svg('<circle cx="8" cy="8" r="2"/><path d="M8 1.8v1.6M8 12.6v1.6M14.2 8h-1.6M3.4 8H1.8M12.4 3.6l-1.1 1.1M4.7 11.3l-1.1 1.1M12.4 12.4l-1.1-1.1M4.7 4.7 3.6 3.6"/>'),
  search: svg('<circle cx="7" cy="7" r="4"/><path d="m10 10 3.5 3.5"/>'),
  moon: svg('<path d="M13 9.5A5.5 5.5 0 0 1 6.5 3a5.5 5.5 0 1 0 6.5 6.5z"/>'),
  sun: svg('<circle cx="8" cy="8" r="2.8"/><path d="M8 1.5v1.3M8 13.2v1.3M14.5 8h-1.3M2.8 8H1.5M12.6 3.4l-.9.9M4.3 11.7l-.9.9M12.6 12.6l-.9-.9M4.3 4.3l-.9-.9"/>'),
  branch: svg('<circle cx="4.5" cy="3.5" r="1.3"/><circle cx="4.5" cy="12.5" r="1.3"/><circle cx="11.5" cy="5.5" r="1.3"/><path d="M4.5 4.8v6.4M11.5 6.8c0 3-7 2-7 4.4"/>', 14),
  check: svg('<path d="m3.5 8.5 3 3 6-7"/>', 14),
  checkCircle: svg('<circle cx="8" cy="8" r="6"/><path d="m5.5 8.2 1.8 1.8 3.4-3.8"/>', 14),
  chevronDown: svg('<path d="m4.5 6.5 3.5 3.5 3.5-3.5"/>', 12),
  chevronRight: svg('<path d="m6.5 4.5 3.5 3.5-3.5 3.5"/>', 12),
  close: svg('<path d="m4.5 4.5 7 7M11.5 4.5l-7 7"/>', 12),
  refresh: svg('<path d="M13 5.5A5.5 5.5 0 1 0 13.2 9"/><path d="M13 2.8v3h-3"/>', 14),
  model: svg('<path d="M8 1.8 13.5 5v6L8 14.2 2.5 11V5z"/><path d="M8 8 13.5 5M8 8 2.5 5M8 8v6.2"/>', 14),
  brain: svg('<path d="M6 2.8a2 2 0 0 0-2 2 2 2 0 0 0-1.5 3.4A2 2 0 0 0 4 11.5a2 2 0 0 0 4 .7V3.5a2 2 0 0 0-2-.7zM10 2.8a2 2 0 0 1 2 2 2 2 0 0 1 1.5 3.4 2 2 0 0 1-1.5 3.3 2 2 0 0 1-4 .7"/>', 14),
  stop: '<svg viewBox="0 0 16 16" width="12" height="12"><rect x="3.5" y="3.5" width="9" height="9" rx="1.5" fill="currentColor"/></svg>',
  reveal: svg('<path d="M9 2.5h4.5V7M13.5 2.5 8 8"/><path d="M12 9.5V13a.5.5 0 0 1-.5.5h-8A.5.5 0 0 1 3 13V5a.5.5 0 0 1 .5-.5H7"/>', 14),
  more: svg('<circle cx="3.5" cy="8" r=".9" fill="currentColor" stroke="none"/><circle cx="8" cy="8" r=".9" fill="currentColor" stroke="none"/><circle cx="12.5" cy="8" r=".9" fill="currentColor" stroke="none"/>', 14),
  trash: svg('<path d="M2.5 4.5h11M6.5 4.5V3a.5.5 0 0 1 .5-.5h2a.5.5 0 0 1 .5.5v1.5M4 4.5l.6 8.6a1 1 0 0 0 1 .9h4.8a1 1 0 0 0 1-.9l.6-8.6M6.8 7v4.5M9.2 7v4.5"/>', 14),
  copy: svg('<rect x="5" y="5" width="8.5" height="8.5" rx="1.5"/><path d="M10.5 5V3.5A1 1 0 0 0 9.5 2.5h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1H5"/>', 14),
};

export function shortPath(value = "", keep = 2): string {
  const parts = String(value).split(/[\\/]/).filter(Boolean);
  return parts.length <= keep ? value : `…/${parts.slice(-keep).join("/")}`;
}

export function baseName(value = ""): string {
  return String(value).split(/[\\/]/).filter(Boolean).at(-1) ?? value;
}

export function relativeTime(timestamp?: number): string {
  if (!timestamp) return "";
  const diff = Date.now() - timestamp;
  const minute = 60_000;
  if (diff < minute) return "刚刚";
  if (diff < 60 * minute) return `${Math.floor(diff / minute)} 分钟前`;
  if (diff < 24 * 60 * minute) return `${Math.floor(diff / (60 * minute))} 小时前`;
  if (diff < 7 * 24 * 60 * minute) return `${Math.floor(diff / (24 * 60 * minute))} 天前`;
  const date = new Date(timestamp);
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

const THINKING_LABELS: Record<string, string> = { off: "关闭", minimal: "极简", low: "低", medium: "中", high: "高", xhigh: "极高" };

/** 思考等级的中文名（Pi 的取值是 off / minimal / low / medium / high / xhigh） */
export function thinkingLabel(level: string): string {
  return THINKING_LABELS[level] ?? level;
}

export function formatTokens(value?: number | null): string {
  if (value == null) return "-";
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)}k`;
  return String(value);
}

export function lineCount(text?: string | null): number {
  return text ? String(text).split(/\r?\n/).length : 0;
}
