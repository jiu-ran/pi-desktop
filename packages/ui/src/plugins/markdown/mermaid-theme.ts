/**
 * Mermaid 主题指令注入。
 *
 * markstream-vue 写死只传 `theme: "dark" | "default"`（库内 `mt()`），
 * 即 Mermaid 自带的两套 stock 主题——这就是图看起来灰、对比度低、
 * 和 Cursor 差很多的直接原因。而 Cursor 聊天区的图是按自家设计语言
 * 调过的主色板（zinc-dark 一套 bg/fg/line/accent/muted，不透明度体系）。
 *
 * 库没有透出 mermaid 初始化配置，但它在拼接源码时留了一个口子：
 * 围栏源码以 `%%{` 开头时不再前置自己的 `%%{init}%%`。于是我们在每个
 * ```mermaid 围栏首行注入自己的 init 指令，`theme: "base"` + 全套
 * themeVariables，接管字体与配色；布局不受影响，无需 fork 库。
 */

const FONT_STACK = `"Inter", "Microsoft YaHei UI", "PingFang SC", "Segoe UI", system-ui, sans-serif`;

interface MermaidPalette {
  background: string;
  primaryColor: string;
  primaryTextColor: string;
  primaryBorderColor: string;
  secondaryColor: string;
  secondaryTextColor: string;
  secondaryBorderColor: string;
  tertiaryColor: string;
  tertiaryTextColor: string;
  tertiaryBorderColor: string;
  lineColor: string;
  textColor: string;
  nodeBorder: string;
  clusterBkg: string;
  clusterBorder: string;
  titleColor: string;
  edgeLabelBackground: string;
  accent: string;
  muted: string;
  code: string;
  ok: string;
  warn: string;
  err: string;
}

/** 深色：对齐桌面端深色主题（--bg-1 容器底 + --fg 文字 + --accent 点缀）。 */
const DARK: MermaidPalette = {
  background: "#1f2023",
  primaryColor: "#2b3a52",
  primaryTextColor: "#e0e1e4",
  primaryBorderColor: "#2a7deb",
  secondaryColor: "#25262a",
  secondaryTextColor: "#e0e1e4",
  secondaryBorderColor: "#393b40",
  tertiaryColor: "#232428",
  tertiaryTextColor: "#909192",
  tertiaryBorderColor: "#393b40",
  lineColor: "#8b95a5",
  textColor: "#e0e1e4",
  nodeBorder: "#2a7deb",
  clusterBkg: "#1b1c1f",
  clusterBorder: "#393b40",
  titleColor: "#e0e1e4",
  edgeLabelBackground: "#1f2023",
  accent: "#2a7deb",
  muted: "#6b6c70",
  code: "#df8538",
  ok: "#3fc28f",
  warn: "#e5a23d",
  err: "#e5534b",
};

/** 浅色：对齐桌面端浅色主题。 */
const LIGHT: MermaidPalette = {
  background: "#f7f8fa",
  primaryColor: "#dce9fb",
  primaryTextColor: "#1f2024",
  primaryBorderColor: "#2a7deb",
  secondaryColor: "#eff0f3",
  secondaryTextColor: "#1f2024",
  secondaryBorderColor: "#d3d5db",
  tertiaryColor: "#f7f8fa",
  tertiaryTextColor: "#6c6f76",
  tertiaryBorderColor: "#d3d5db",
  lineColor: "#6c6f76",
  textColor: "#1f2024",
  nodeBorder: "#2a7deb",
  clusterBkg: "#ffffff",
  clusterBorder: "#d3d5db",
  titleColor: "#1f2024",
  edgeLabelBackground: "#f7f8fa",
  accent: "#2a7deb",
  muted: "#9a9da4",
  code: "#c25f12",
  ok: "#14845f",
  warn: "#b7741d",
  err: "#d0392f",
};

function themeVariables(p: MermaidPalette): Record<string, string | boolean> {
  return {
    darkMode: p === DARK,
    background: p.background,
    fontFamily: FONT_STACK,
    primaryColor: p.primaryColor,
    primaryTextColor: p.primaryTextColor,
    primaryBorderColor: p.primaryBorderColor,
    secondaryColor: p.secondaryColor,
    secondaryTextColor: p.secondaryTextColor,
    secondaryBorderColor: p.secondaryBorderColor,
    tertiaryColor: p.tertiaryColor,
    tertiaryTextColor: p.tertiaryTextColor,
    tertiaryBorderColor: p.tertiaryBorderColor,
    lineColor: p.lineColor,
    textColor: p.textColor,
    mainBkg: p.primaryColor,
    secondBkg: p.secondaryColor,
    nodeBorder: p.nodeBorder,
    clusterBkg: p.clusterBkg,
    clusterBorder: p.clusterBorder,
    defaultLinkColor: p.lineColor,
    titleColor: p.titleColor,
    edgeLabelBackground: p.edgeLabelBackground,
    // 时序图
    actorBorder: p.primaryBorderColor,
    actorBkg: p.secondaryColor,
    actorTextColor: p.textColor,
    actorLineColor: p.muted,
    signalColor: p.lineColor,
    signalTextColor: p.textColor,
    labelBoxBkgColor: p.secondaryColor,
    labelBoxBorderColor: p.secondaryBorderColor,
    labelTextColor: p.textColor,
    loopTextColor: p.textColor,
    noteBorderColor: p.secondaryBorderColor,
    noteBkgColor: p.secondaryColor,
    noteTextColor: p.textColor,
    activationBorderColor: p.primaryBorderColor,
    activationBkgColor: p.primaryColor,
    sequenceNumberColor: p.background,
    // 类图 / 状态图 / ER / 需求
    classText: p.textColor,
    fillType0: p.primaryColor,
    fillType1: p.secondaryColor,
    fillType2: "#3a3f47",
    fillType3: "#3a3f47",
    fillType4: "#3a3f47",
    fillType5: "#3a3f47",
    fillType6: "#3a3f47",
    fillType7: "#3a3f47",
    labelColor: p.textColor,
    altBackground: p.secondaryColor,
    compositeBackground: p.background,
    compositeTitleBackground: p.secondaryColor,
    stateBorder: p.secondaryBorderColor,
    requirementBackground: p.secondaryColor,
    requirementBorderColor: p.primaryBorderColor,
    requirementTextColor: p.textColor,
    relationColor: p.lineColor,
    relationLabelBackground: p.edgeLabelBackground,
    relationLabelColor: p.textColor,
    // 甘特图
    sectionBkgColor: p.secondaryColor,
    altSectionBkgColor: p.background,
    sectionBkgColor2: p.secondaryColor,
    taskBorderColor: p.secondaryBorderColor,
    taskBkgColor: p.secondaryColor,
    taskTextColor: p.textColor,
    taskTextLightColor: p.textColor,
    taskTextOutsideColor: p.muted,
    activeTaskBkgColor: p.primaryColor,
    activeTaskBorderColor: p.primaryBorderColor,
    critBkgColor: p.err,
    critBorderColor: p.err,
    doneTaskBkgColor: p.muted,
    doneTaskBorderColor: p.muted,
    todayLineColor: p.err,
    gridColor: p.secondaryBorderColor,
    // 饼图
    pieTitleTextColor: p.titleColor,
    pieSectionTextColor: p.textColor,
    pieLegendTextColor: p.muted,
    pieStrokeColor: p.background,
    pie1: p.accent,
    pie2: p.ok,
    pie3: p.warn,
    pie4: p.code,
    pie5: "#b451ff",
    pie6: "#00cbd7",
    pie7: p.err,
    pie8: p.muted,
    pie9: p.primaryBorderColor,
    pie10: p.tertiaryTextColor,
    pie11: p.lineColor,
    pie12: p.secondaryBorderColor,
    pieOpacity: "0.9",
    // git 图
    git0: p.accent,
    git1: p.ok,
    git2: p.warn,
    git3: p.code,
    git4: "#b451ff",
    git5: "#00cbd7",
    git6: p.err,
    git7: p.muted,
    commitLabelColor: p.textColor,
    commitLabelBackground: p.secondaryColor,
    tagLabelColor: p.background,
    tagLabelBackground: p.accent,
    tagLabelBorder: p.accent,
    // xychart
    xAxisLineColor: p.lineColor,
    xAxisLabelColor: p.muted,
    yAxisLineColor: p.lineColor,
    yAxisLabelColor: p.muted,
    plotColorPalette: `${p.accent},${p.ok},${p.warn},${p.code},#b451ff,#00cbd7,${p.err}`,
  };
}

export interface MermaidInitConfig {
  theme: "base";
  themeVariables: Record<string, string | boolean>;
  themeCSS: string;
  /** elk 对齐 Cursor 的纵向分层布局；htmlLabels 交给调用方的 strict 配置。 */
  flowchart: { defaultRenderer: "elk"; htmlLabels?: boolean };
  layout: "elk";
  securityLevel: "strict";
}

/**
 * 组装 init 配置。边线加粗半像素解决截图里“线太细发虚”的观感；
 * 流程图固定 elk，避免 markstream 只传 htmlLabels 时退回 dagre。
 */
export function buildMermaidInitConfig(isDark: boolean): MermaidInitConfig {
  const palette = isDark ? DARK : LIGHT;
  return {
    theme: "base",
    themeVariables: themeVariables(palette),
    themeCSS: ".edgePath path{stroke-width:1.5px}.flowchart-link{stroke-width:1.5px}.node rect,.node polygon,.node circle{rx:8;ry:8}",
    flowchart: { defaultRenderer: "elk" },
    layout: "elk",
    securityLevel: "strict",
  };
}

export function buildMermaidInitDirective(isDark: boolean): string {
  return `%%{init: ${JSON.stringify(buildMermaidInitConfig(isDark))}}%%`;
}

const FENCE = /```mermaid[^\S\n]*\n([\s\S]*?)(?:```|$)/g;

/**
 * 给每个 ```mermaid 围栏首行注入主题指令。已有 `%%{` 开头的围栏不动
 * （库同样会跳过，用户显式配置优先）。
 */
export function injectMermaidTheme(content: string, isDark: boolean): string {
  const directive = buildMermaidInitDirective(isDark);
  return content.replace(FENCE, (whole, code: string) => {
    if (String(code).trimStart().startsWith("%%{")) return whole;
    return whole.replace(/```mermaid[^\S\n]*\n/, (head: string) => `${head}${directive}\n`);
  });
}
