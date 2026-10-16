import ELK from "elkjs/lib/elk.bundled.js";
import mermaid from "mermaid";

export interface CursorNode {
  id: string;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CursorCluster {
  id: string;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  labelX: number;
  labelY: number;
  labelAnchor: "start" | "middle" | "end";
  labelVertical: boolean;
}

export interface CursorEdge {
  id: string;
  points: Array<{ x: number; y: number }>;
  label: string;
  labelX: number;
  labelY: number;
  labelWidth: number;
  labelHeight: number;
}

export interface CursorDiagram {
  nodes: CursorNode[];
  clusters: CursorCluster[];
  edges: CursorEdge[];
  width: number;
  height: number;
}

interface FlowNode {
  id: string;
  label: string;
  width: number;
  height: number;
  parent?: string;
}

interface FlowCluster {
  id: string;
  label: string;
  parent?: string;
}

interface FlowEdge {
  id: string;
  source: string;
  target: string;
  label: string;
}

const measureCanvas = typeof document === "undefined" ? null : document.createElement("canvas");
const measureContext = measureCanvas?.getContext("2d") ?? null;

function linesOf(label: string): string[] {
  return label
    .replace(/<br\s*\/?>/gi, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function widthOf(label: string): number {
  const lines = linesOf(label);
  if (!measureContext) return Math.max(96, Math.max(...lines.map((line) => line.length)) * 13 + 32);
  measureContext.font = "13px Inter, Segoe UI, sans-serif";
  const widest = Math.max(...lines.map((line) => measureContext.measureText(line).width));
  return Math.max(96, Math.ceil(widest) + 36);
}

function heightOf(label: string): number {
  return Math.max(42, linesOf(label).length * 18 + 20);
}

function parseFlow(code: string): { nodes: FlowNode[]; clusters: FlowCluster[]; edges: FlowEdge[] } {
  const clusters: FlowCluster[] = [];
  const nodes: FlowNode[] = [];
  const edges: FlowEdge[] = [];
  const stack: string[] = [];
  const nodeIndex = new Map<string, FlowNode>();
  const ensure = (id: string, label = id): FlowNode => {
    const found = nodeIndex.get(id);
    if (found) {
      if (label !== id) {
        found.label = label;
        found.width = widthOf(label);
        found.height = heightOf(label);
      }
      return found;
    }
    const node = { id, label, width: widthOf(label), height: heightOf(label), parent: stack.at(-1) };
    nodes.push(node);
    nodeIndex.set(id, node);
    return node;
  };
  const text = (value: string): string => value.trim().replace(/^["']|["']$/g, "");
  const endpoint = (value: string): { id: string; label: string } | null => {
    const matched = value.trim().match(/^([\w./:-]+)(?:\s*(?:\[([^\]]*)\]|\(([^)]*)\)|\{([^}]*)\}))?$/);
    if (!matched) return null;
    return { id: matched[1], label: text(matched[2] ?? matched[3] ?? matched[4] ?? matched[1]) };
  };

  for (const raw of code.split(/\r?\n/)) {
    const line = raw.trim().replace(/;$/, "");
    if (!line || line.startsWith("%%") || /^(graph|flowchart)\b/i.test(line)) continue;
    if (/^end$/i.test(line)) {
      stack.pop();
      continue;
    }
    const subgraph = line.match(/^subgraph\s+([\w-]+)(?:\s*\[([^\]]+)\])?$/i);
    if (subgraph) {
      clusters.push({ id: subgraph[1], label: text(subgraph[2] ?? subgraph[1]), parent: stack.at(-1) });
      stack.push(subgraph[1]);
      continue;
    }
    const nodeOnly = endpoint(line);
    if (nodeOnly && !/-->|---|==>/.test(line)) {
      ensure(nodeOnly.id, nodeOnly.label);
      continue;
    }
    const link = line.match(/^(.*?)\s*(?:-->|---|==>)(?:\|([^|]+)\|)?\s*(.*)$/);
    if (!link) continue;
    const source = endpoint(link[1]);
    const target = endpoint(link[3]);
    if (!source || !target) continue;
    ensure(source.id, source.label);
    ensure(target.id, target.label);
    edges.push({ id: `e${edges.length}`, source: source.id, target: target.id, label: text(link[2] ?? "") });
  }
  return { nodes, clusters, edges };
}

function cleanLabel(value: unknown): string {
  return String(value)
    .replace(/^"|"$/g, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .trim();
}

function collect(node: any, nodes: CursorNode[], clusters: CursorCluster[], parentX = 0, parentY = 0): void {
  const x = parentX + (node.x ?? 0);
  const y = parentY + (node.y ?? 0);
  if (node.labels?.[0]?.text) {
    clusters.push({
      id: node.id,
      label: node.labels[0].text,
      x,
      y,
      width: node.width,
      height: node.height,
      labelX: x + node.width / 2,
      labelY: y + 18,
      labelAnchor: "middle",
      labelVertical: false,
    });
  } else if (node.id !== "root") {
    nodes.push({
      id: node.id,
      label: node._label ?? node.id,
      x,
      y,
      width: node.width,
      height: node.height,
    });
  }
  for (const child of node.children ?? []) collect(child, nodes, clusters, x, y);
}

/** 解析 flowchart/graph，使用 elk 分层布局，输出 Cursor 风格绘图数据。 */
export async function layoutCursorFlow(code: string): Promise<CursorDiagram> {
  const flow = parseFlow(code);
  if (!flow.nodes.length) {
    await mermaid.parse(code);
    return { nodes: [], clusters: [], edges: [], width: 320, height: 80 };
  }
  const children = new Map<string, any[]>();
  const child = (parent = "root"): any[] => {
    const list = children.get(parent) ?? [];
    children.set(parent, list);
    return list;
  };
  for (const cluster of flow.clusters) {
    child(cluster.parent).push({
      id: cluster.id,
      labels: [{ text: cluster.label }],
      layoutOptions: {
        "elk.algorithm": "layered",
        "elk.direction": "DOWN",
        "elk.padding": "[top=58,left=42,bottom=24,right=24]",
        "elk.spacing.nodeNode": "28",
        "elk.layered.spacing.nodeNodeBetweenLayers": "42",
      },
    });
  }
  for (const node of flow.nodes) {
    child(node.parent).push({ id: node.id, width: node.width, height: node.height, _label: node.label });
  }
  const attach = (items: any[]): any[] => items.map((item) => (
    children.has(item.id) ? { ...item, children: attach(children.get(item.id) ?? []) } : item
  ));
  const graph = {
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": "DOWN",
      "elk.spacing.nodeNode": "48",
      "elk.layered.spacing.nodeNodeBetweenLayers": "72",
      "elk.spacing.edgeNode": "42",
      "elk.spacing.edgeEdge": "34",
      "elk.layered.spacing.edgeNodeBetweenLayers": "36",
      "elk.layered.spacing.edgeEdgeBetweenLayers": "30",
      "elk.layered.crossingMinimization.strategy": "LAYER_SWEEP",
      "elk.edgeRouting": "ORTHOGONAL",
      "elk.hierarchyHandling": "INCLUDE_CHILDREN",
      "elk.layered.nodePlacement.strategy": "NETWORK_SIMPLEX",
    },
    children: attach(children.get("root") ?? []),
    edges: flow.edges.map((edge) => ({ id: edge.id, sources: [edge.source], targets: [edge.target] })),
  };
  const laidOut = await new ELK().layout(graph);
  const nodes: CursorNode[] = [];
  const clusters: CursorCluster[] = [];
  collect(laidOut, nodes, clusters);
  const offsets = new Map<string, { x: number; y: number }>();
  const walk = (item: any, parentX = 0, parentY = 0): void => {
    const x = parentX + (item.x ?? 0);
    const y = parentY + (item.y ?? 0);
    offsets.set(item.id, { x, y });
    for (const child of item.children ?? []) walk(child, x, y);
  };
  walk(laidOut);
  const labels = new Map(flow.edges.map((edge) => [edge.id, edge.label]));
  const nestedEdges: any[] = [];
  const gather = (item: any): void => {
    nestedEdges.push(...(item.edges ?? []));
    for (const child of item.children ?? []) gather(child);
  };
  gather(laidOut);
  const edges = nestedEdges.flatMap((edge: any) => {
    const section = edge.sections?.[0];
    const container = offsets.get(edge.container) ?? { x: 0, y: 0 };
    if (!section?.startPoint || !section?.endPoint) return [];
    const points = [section.startPoint, ...(section.bendPoints ?? []), section.endPoint]
      .map((point) => ({ x: container.x + point.x, y: container.y + point.y }));
    const middle = points[Math.floor(points.length / 2)];
    const label = labels.get(edge.id) ?? "";
    return [{
      id: edge.id,
      points,
      label,
      labelX: middle.x,
      labelY: middle.y - 8,
      labelWidth: widthOf(labels.get(edge.id) ?? ""),
      labelHeight: 24,
    }];
  });
  const hits = (edge: CursorEdge, left: number, top: number, right: number, bottom: number): boolean => edge.points.some((point, index) => {
    const next = edge.points[index + 1];
    if (!next) return false;
    const vertical = point.x === next.x;
    return vertical
      ? point.x >= left && point.x <= right && Math.max(point.y, next.y) >= top && Math.min(point.y, next.y) <= bottom
      : point.y >= top && point.y <= bottom && Math.max(point.x, next.x) >= left && Math.min(point.x, next.x) <= right;
  });
  const crosses = (cluster: CursorCluster, side: "left" | "right" | "top"): boolean => {
    const box = side === "top"
      ? [cluster.x + cluster.width / 2 - 55, cluster.y + 4, cluster.x + cluster.width / 2 + 55, cluster.y + 30]
      : side === "left"
        ? [cluster.x + 8, cluster.y + 4, cluster.x + 78, cluster.y + 30]
        : [cluster.x + cluster.width - 78, cluster.y + 4, cluster.x + cluster.width - 8, cluster.y + 30];
    return edges.some((edge) => hits(edge, box[0], box[1], box[2], box[3]));
  };
  const inset = 28;
  for (const node of nodes) node.x += inset;
  for (const cluster of clusters) {
    cluster.x += inset;
    cluster.labelX += inset;
  }
  for (const edge of edges) {
    edge.labelX += inset;
    for (const point of edge.points) point.x += inset;
  }
  const overlaps = (edge: CursorEdge, x: number): boolean => nodes.some((node) => {
    const left = x - edge.labelWidth / 2;
    const right = x + edge.labelWidth / 2;
    const top = edge.labelY - edge.labelHeight / 2;
    const bottom = edge.labelY + edge.labelHeight / 2;
    return right > node.x && left < node.x + node.width && bottom > node.y && top < node.y + node.height;
  });
  for (const edge of edges) {
    if (!edge.label) continue;
    let x = edge.labelX;
    for (let step = 0; step < 8 && overlaps(edge, x); step += 1) x += edge.labelWidth + 12;
    edge.labelX = x;
  }
  for (const cluster of clusters) {
    const side = (["left", "right", "top"] as const).find((item) => !crosses(cluster, item)) ?? "top";
    cluster.labelVertical = false;
    cluster.labelAnchor = "middle";
    cluster.labelX = cluster.x + cluster.width / 2;
    cluster.labelY = cluster.y + 18;
  }
  return {
    nodes,
    clusters,
    edges,
    width: Math.ceil(laidOut.width ?? 320) + inset + 28,
    height: Math.ceil(laidOut.height ?? 120) + 24,
  };
}
