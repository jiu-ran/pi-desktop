/**
 * 解析 pi 的规范技能调用块（`/skill:name` 展开后的用户消息）。
 *
 * 解析规则移植自 ThinkRail（JetBrains/thinkrail，Apache-2.0）的
 * `apps/web/src/lib/skillInvocation.ts`，并与 pi 的 `parseSkillBlock` 保持一致：
 * `<skill name="…" location="…">正文</skill>`，可带一段调用者追加的问题。
 */

export interface SkillInvocation {
  name: string;
  location: string;
  content: string;
  userMessage?: string;
}

const SKILL_BLOCK =
  /^<skill name="([^"]+)" location="([^"]+)">\n([\s\S]*?)\n<\/skill>(?:\n\n([\s\S]+))?$/;

export function parseSkillInvocation(text: string): SkillInvocation | null {
  const match = SKILL_BLOCK.exec(text.trim());
  if (!match) return null;
  const [, name, location, content, userMessage] = match;
  if (name === undefined || location === undefined || content === undefined) return null;
  const request = userMessage?.trim();
  return {
    name,
    location,
    content,
    ...(request ? { userMessage: request } : {}),
  };
}
