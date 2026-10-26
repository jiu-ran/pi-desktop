import type { SettingsTabId } from "../../../services/settings.ts";
import { icons } from "../../../shared/icons.ts";

/**
 * 设置页的目录：一级分区 + 二级 tab。
 *
 * 拆成纯数据是为了三件事：搜索、分区归属、以及「新增一页要改哪几处」只有一处。
 * 组件只负责渲染，判断都在这里，方便单测（scripts/checks/settings-tabs.check.ts）。
 */

export interface SettingsTabMeta {
  id: SettingsTabId;
  label: string;
  icon: string;
  desc: string;
  /**
   * 搜索关键字：用户敲的往往是具体的设置项（「深色」「字号」「快捷键」），
   * 而不是页名。没有这层，搜「深色」一个结果都没有。
   */
  keywords: string[];
}

export interface SettingsSectionMeta {
  id: string;
  label: string;
  icon: string;
  desc: string;
  tabs: SettingsTabId[];
}

export const SETTINGS_TABS: SettingsTabMeta[] = [
  {
    id: "conversation",
    label: "对话与并发",
    icon: icons.chat,
    desc: "多会话并行策略、发送方式、文件自动保存与 Agent 自动化配置",
    keywords: ["发送", "回车", "enter", "换行", "排队", "引导", "steer", "follow-up", "自动保存", "冲突", "压缩", "重试", "通知", "思考", "worker", "并发", "键盘"],
  },
  {
    id: "appearance",
    label: "外观与布局",
    icon: icons.palette,
    desc: "配色模式、强调色、圆角、字号排版与各工作区面板宽度",
    keywords: ["主题", "深色", "浅色", "跟随系统", "颜色", "配色", "强调色", "高亮", "圆角", "字号", "字体", "列宽", "宽度", "密度", "紧凑", "动效", "动画", "布局", "侧边栏"],
  },
  {
    id: "terminal",
    label: "终端",
    icon: icons.terminal,
    desc: "终端程序、启动参数、滚动行数与字体",
    keywords: ["终端", "shell", "pwsh", "powershell", "bash", "cmd", "字体", "字号", "行数", "滚动", "参数"],
  },
  {
    id: "mcp",
    label: "MCP 服务配置",
    icon: icons.mcp,
    desc: "接入 Model Context Protocol 服务，管理全局与项目级配置",
    keywords: ["mcp", "服务器", "服务", "server", "工具", "tools", "全局", "项目", "json"],
  },
  {
    id: "packages",
    label: "Pi 软件包管理",
    icon: icons.package,
    desc: "浏览与安装 Pi 生态里的扩展包",
    keywords: ["软件包", "扩展", "安装", "卸载", "npm", "生态"],
  },
  {
    id: "agents",
    label: "全局提示词",
    icon: icons.file,
    desc: "编写跨项目生效的 AGENTS.md，作为所有会话的默认指令",
    keywords: ["agents.md", "提示词", "prompt", "指令", "全局", "规则", "默认"],
  },
  {
    id: "skills",
    label: "Skills",
    icon: icons.brain,
    desc: "查看全局与项目级技能（Skills）的加载状态、作用域与调用方式",
    keywords: ["技能", "skill", "目录", "作用域", "加载", "调用"],
  },
  {
    id: "plugins",
    label: "插件",
    icon: icons.puzzle,
    desc: "启用或停用桌面端插件，插件会向界面注入面板、命令与工具",
    keywords: ["插件", "启用", "停用", "面板", "命令", "注入"],
  },
  {
    id: "environment",
    label: "环境与快捷键",
    icon: icons.gear,
    desc: "Pi 安装状态、更新渠道、活动项目目录与键盘快捷键",
    keywords: ["路径", "安装", "版本", "更新", "渠道", "目录", "快捷键", "键盘", "可执行文件"],
  },
  {
    id: "logs",
    label: "运行日志",
    icon: icons.text,
    desc: "主进程 / 渲染进程 / Pi / 卡顿日志，总量上限 100MB，可打开目录或清理",
    keywords: ["日志", "log", "主进程", "渲染", "卡顿", "清理", "上限"],
  },
];

export const SETTINGS_SECTIONS: SettingsSectionMeta[] = [
  { id: "chat", label: "对话", icon: icons.chat, desc: "怎么说、怎么排队", tabs: ["conversation", "agents"] },
  {
    id: "power",
    label: "能力",
    icon: icons.puzzle,
    desc: "Pi 自带的技能、MCP 服务、扩展包与插件",
    tabs: ["skills", "mcp", "packages", "plugins"],
  },
  { id: "look", label: "外观", icon: icons.palette, desc: "配色、字号与面板宽度", tabs: ["appearance"] },
  {
    id: "desktop",
    label: "桌面",
    icon: icons.terminal,
    desc: "终端、快捷键、本机 Pi 与日志",
    tabs: ["terminal", "environment", "logs"],
  },
];

export const ALL_TAB_IDS: SettingsTabId[] = SETTINGS_SECTIONS.flatMap((section) => section.tabs);

export function findSettingsTab(id: SettingsTabId): SettingsTabMeta {
  return SETTINGS_TABS.find((tab) => tab.id === id) ?? SETTINGS_TABS[0]!;
}

export function sectionOfTab(id: SettingsTabId): SettingsSectionMeta {
  return SETTINGS_SECTIONS.find((section) => section.tabs.includes(id)) ?? SETTINGS_SECTIONS[0]!;
}

export function sectionTabs(section: SettingsSectionMeta): SettingsTabMeta[] {
  return section.tabs.map((id) => findSettingsTab(id));
}

export interface SettingsSearchHit extends SettingsTabMeta {
  sectionLabel: string;
  /** 命中的关键字（页名 / 说明 / 分区名命中时为空） */
  keyword: string;
}

/**
 * 搜索：跨分区平铺命中的二级页，命中范围 = 页名 / 说明 / 分区名 / 关键字。
 * 页名直接命中的排前面（敲「终端」时，终端页应该排第一）。
 */
export function searchSettings(query: string): SettingsSearchHit[] {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return [];
  const hits: Array<SettingsSearchHit & { rank: number }> = [];
  for (const section of SETTINGS_SECTIONS) {
    for (const tab of sectionTabs(section)) {
      const label = tab.label.toLocaleLowerCase();
      const desc = tab.desc.toLocaleLowerCase();
      const sectionLabel = section.label.toLocaleLowerCase();
      const keyword = (tab.keywords ?? []).find((item) => item.toLocaleLowerCase().includes(needle));
      const rank = label.includes(needle) ? 0 : keyword ? 1 : desc.includes(needle) || sectionLabel.includes(needle) ? 2 : -1;
      if (rank < 0) continue;
      hits.push({ ...tab, sectionLabel: section.label, keyword: keyword ?? "", rank });
    }
  }
  return hits.sort((a, b) => a.rank - b.rank).map(({ rank: _rank, ...rest }) => rest);
}
