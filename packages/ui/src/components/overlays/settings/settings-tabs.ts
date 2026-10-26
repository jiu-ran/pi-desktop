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
  },
  {
    id: "appearance",
    label: "外观与布局",
    icon: icons.palette,
    desc: "配色模式、强调色、圆角、字号排版与各工作区面板宽度",
  },
  {
    id: "terminal",
    label: "终端",
    icon: icons.terminal,
    desc: "终端程序、启动参数、滚动行数与字体",
  },
  {
    id: "mcp",
    label: "MCP 服务配置",
    icon: icons.mcp,
    desc: "接入 Model Context Protocol 服务，管理全局与项目级配置",
  },
  {
    id: "packages",
    label: "Pi 软件包管理",
    icon: icons.package,
    desc: "浏览与安装 Pi 生态里的扩展包",
  },
  {
    id: "agents",
    label: "全局提示词",
    icon: icons.file,
    desc: "编写跨项目生效的 AGENTS.md，作为所有会话的默认指令",
  },
  {
    id: "skills",
    label: "Skills",
    icon: icons.brain,
    desc: "查看全局与项目级技能（Skills）的加载状态、作用域与调用方式",
  },
  {
    id: "plugins",
    label: "插件",
    icon: icons.puzzle,
    desc: "启用或停用桌面端插件，插件会向界面注入面板、命令与工具",
  },
  {
    id: "environment",
    label: "环境与快捷键",
    icon: icons.gear,
    desc: "Pi 安装状态、更新渠道、活动项目目录与键盘快捷键",
  },
  {
    id: "logs",
    label: "运行日志",
    icon: icons.text,
    desc: "主进程 / 渲染进程 / Pi / 卡顿日志，总量上限 100MB，可打开目录或清理",
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

/** 搜索：跨分区平铺命中的二级页，命中范围包含页名、说明与所属分区名 */
export function searchSettings(query: string): Array<SettingsTabMeta & { sectionLabel: string }> {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return [];
  return SETTINGS_SECTIONS.flatMap((section) =>
    sectionTabs(section)
      .filter((tab) => `${tab.label} ${tab.desc} ${section.label}`.toLocaleLowerCase().includes(needle))
      .map((tab) => ({ ...tab, sectionLabel: section.label })),
  );
}
