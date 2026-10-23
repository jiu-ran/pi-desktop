import { bundledLanguages, createHighlighter, type BundledLanguage, type Highlighter } from "shiki";

export interface HighlightToken {
  content: string;
  color?: string;
}

const loaded = new Set<BundledLanguage>();
let highlighterPromise: Promise<Highlighter> | null = null;

function highlighter(): Promise<Highlighter> {
  highlighterPromise ??= createHighlighter({
    themes: ["github-dark", "github-light"],
    langs: ["markdown"],
  });
  return highlighterPromise;
}

export function normalizeLanguage(language = ""): BundledLanguage | "text" {
  const value = language.trim().toLowerCase();
  const aliases: Record<string, BundledLanguage> = {
    js: "javascript",
    jsx: "jsx",
    ts: "typescript",
    tsx: "tsx",
    py: "python",
    sh: "bash",
    shell: "bash",
    yml: "yaml",
    md: "markdown",
    vue: "vue",
  };
  const resolved = aliases[value] ?? value;
  return resolved in bundledLanguages ? resolved as BundledLanguage : "text";
}

export async function highlightCode(code: string, language: string, dark: boolean): Promise<HighlightToken[][]> {
  // 大文件每键重跑正则语法高亮会冻结界面；文本仍可正常编辑。
  if (code.length > 150_000) return code.split(/\r?\n/).map(content => [{ content }]);
  const engine = await highlighter();
  const resolved = normalizeLanguage(language);
  if (resolved !== "text" && !loaded.has(resolved)) {
    await engine.loadLanguage(resolved);
    loaded.add(resolved);
  }
  const { tokens } = engine.codeToTokens(code, {
    lang: resolved === "text" ? "text" : resolved,
    theme: dark ? "github-dark" : "github-light",
  });
  return tokens.map((line) => line.map((token) => ({
    content: token.content,
    color: token.color,
  })));
}

export function highlightMarkdown(code: string, dark: boolean): Promise<HighlightToken[][]> {
  return highlightCode(code, "markdown", dark);
}
