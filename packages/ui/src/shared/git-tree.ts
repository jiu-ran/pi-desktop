import type { RepoChange } from "./git-changes.ts";

export interface ChangeTreeFile {
  kind: "file";
  name: string;
  path: string;
  change: RepoChange;
}

export interface ChangeTreeFolder {
  kind: "folder";
  name: string;
  path: string;
  /** 文件夹下的文件数量 */
  count: number;
  children: ChangeTreeNode[];
}

export type ChangeTreeNode = ChangeTreeFolder | ChangeTreeFile;

export interface ChangeTreeRow {
  kind: "folder" | "file";
  id: string;
  depth: number;
  name: string;
  path: string;
  count?: number;
  change?: RepoChange;
}

/** 把扁平的文件列表组织成按目录分层的树，并对单链目录做压缩（a/b/c）。 */
export function buildChangeTree(changes: RepoChange[]): ChangeTreeNode[] {
  const root: ChangeTreeFolder = { kind: "folder", name: "", path: "", count: 0, children: [] };

  for (const change of changes) {
    const segments = change.path.split("/").filter(Boolean);
    if (!segments.length) continue;
    let folder = root;
    for (let index = 0; index < segments.length - 1; index += 1) {
      const name = segments[index];
      let next = folder.children.find(
        (child): child is ChangeTreeFolder => child.kind === "folder" && child.name === name,
      );
      if (!next) {
        next = {
          kind: "folder",
          name,
          path: segments.slice(0, index + 1).join("/"),
          count: 0,
          children: [],
        };
        folder.children.push(next);
      }
      folder = next;
    }
    folder.children.push({
      kind: "file",
      name: segments.at(-1) ?? change.path,
      path: change.path,
      change,
    });
  }

  const finish = (folder: ChangeTreeFolder): ChangeTreeFolder => {
    const children = folder.children.map((child) => (child.kind === "folder" ? finish(child) : child));
    children.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === "folder" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    const count = children.reduce(
      (total, child) => total + (child.kind === "folder" ? child.count : 1),
      0,
    );
    let node: ChangeTreeFolder = { ...folder, children, count };
    // 只有一个子目录、且自己没有文件时合并成 a/b/c，减少无意义的层级
    while (node.children.length === 1 && node.children[0].kind === "folder") {
      const child = node.children[0];
      node = { ...child, name: `${node.name}/${child.name}` };
    }
    return node;
  };

  return root.children.map((child) => (child.kind === "folder" ? finish(child) : child));
}

/** 按展开状态把树压平成可直接渲染的行。 */
export function flattenChangeTree(
  nodes: ChangeTreeNode[],
  collapsed: Set<string>,
  depth = 0,
): ChangeTreeRow[] {
  const rows: ChangeTreeRow[] = [];
  for (const node of nodes) {
    if (node.kind === "folder") {
      rows.push({
        kind: "folder",
        id: `dir:${node.path}`,
        depth,
        name: node.name,
        path: node.path,
        count: node.count,
      });
      if (!collapsed.has(node.path)) rows.push(...flattenChangeTree(node.children, collapsed, depth + 1));
      continue;
    }
    rows.push({
      kind: "file",
      id: `file:${node.path}`,
      depth,
      name: node.name,
      path: node.path,
      change: node.change,
    });
  }
  return rows;
}
