import { shallowRef } from "vue";
import type { GitInspectResult, GitOverview } from "../../env.d.ts";
import type { ChangeFileItem } from "../../shared/diff.ts";

/** 最近一次读取到的仓库概览，面板与活动栏角标共用。 */
export const overviewState = shallowRef<GitOverview | null>(null);

/** 详情视图的数据源：实时 Git diff 或会话快照。 */
export type GitDiffSource = "live" | "snapshot";

export interface GitStageData {
  kind: "commit" | "working" | "session";
  target: string;
  source: GitDiffSource;
  loading: boolean;
  error: string;
  detail: GitInspectResult | null;
  /** 会话快照（source === "snapshot" 时使用） */
  session: ChangeFileItem | null;
  /** 该文件是否同时存在实时 diff，可来回切换 */
  hasLive: boolean;
}

let overviewToken = 0;

/** 读取并缓存当前项目的 Git 概览，供面板、角标和对话区变更条共用。 */
export async function refreshOverviewState(workbench: { state: { activeCwd: string }; gitOverview: () => Promise<GitOverview> }): Promise<void> {
  const cwd = workbench.state.activeCwd;
  if (!cwd) {
    overviewState.value = null;
    return;
  }
  const token = (overviewToken += 1);
  try {
    const overview = await workbench.gitOverview();
    if (token === overviewToken) overviewState.value = overview;
  } catch {
    if (token === overviewToken) overviewState.value = null;
  }
}
