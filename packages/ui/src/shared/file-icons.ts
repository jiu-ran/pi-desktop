/**
 * 文件 / 文件夹图标：只有一套默认图形，不按类型区分。
 *
 * 以前的实现挂了一整套 Material Icon Theme（162 个图标 / 218 扩展名 / 65 文件名 /
 * 45 文件夹名 + 三套主题），文件树里一眼看去全是彩色图形，反而认不出「哪个是文件夹」：
 * 生成脚本只内联映射表里引用到的图标，而 `folder` 是通用兜底名、不在任何表里，
 * 于是普通文件夹退成了文件的形状。既然类型图标带来的信息量抵不过噪音，
 * 这里就只留两种图形：文件夹 = `folder`，其余 = `document`。
 *
 * 想恢复按类型上色时，把 Material 生成脚本和它的映射表一起加回来即可，
 * 调用方（`FileIcon.vue`）不用改。
 */

export interface FileIconView {
  /** 固定的两个名字之一：`folder` / `document` */
  icon: "folder" | "document";
  /** 给人看的类型名 */
  label: string;
  /** SVG 的 viewBox */
  viewBox: string;
  /** SVG 内容（只有 currentColor，跟随主题与文字色） */
  body: string;
  isFolder: boolean;
}

/** 文件夹：Material 风格的实心文件夹（24 网格） */
const FOLDER_ICON = {
  viewBox: "0 0 24 24",
  body: '<path fill="currentColor" d="M10 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-8z"/>',
} as const;

/** 文件：一张带折角的纸（24 网格） */
const FILE_ICON = {
  viewBox: "0 0 24 24",
  body:
    '<path fill="currentColor" d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zm-1 7V3.5L18.5 9z"/>',
} as const;

/**
 * 解析成界面要用的视图。
 * `name` 保留参数位：现在的实现不用它，调用方也就不用为了「不区分类型」改一遍。
 */
export function resolveFileIcon(
  _name: string,
  options: { isFolder?: boolean; theme?: string } = {},
): FileIconView {
  const isFolder = Boolean(options.isFolder);
  const icon = isFolder ? FOLDER_ICON : FILE_ICON;
  return {
    icon: isFolder ? "folder" : "document",
    label: isFolder ? "文件夹" : "文件",
    viewBox: icon.viewBox,
    body: icon.body,
    isFolder,
  };
}
