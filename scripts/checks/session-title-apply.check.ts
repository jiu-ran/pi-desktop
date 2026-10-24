import assert from "node:assert/strict";
import { applySessionName, sessionKey } from "../../packages/ui/src/shared/session-title.ts";

const sessions = [
  { path: "C:\\Work\\Proj\\a.jsonl", title: "旧名称", empty: false },
  { path: "C:\\Work\\Proj\\b.jsonl", title: "其他", empty: false },
];

// 1. 同一会话（分隔符与大小写不同）应被更新，其它会话保持不变
const renamed = applySessionName(sessions, "c:/work/proj/A.jsonl", "新名称");
assert.equal(renamed[0].title, "新名称", "路径分隔符和大小写不同仍应命中同一会话");
assert.equal(renamed[1].title, "其他", "其它会话不受影响");

// 2. 纯函数：不修改入参
assert.equal(sessions[0].title, "旧名称", "不得原地修改入参");
assert.notStrictEqual(renamed, sessions, "应返回新数组");

// 3. 空名称或空路径：保持原样，不把标题清空
assert.equal(applySessionName(sessions, "C:\\Work\\Proj\\a.jsonl", "")[0].title, "旧名称", "空名称不得覆盖标题");
assert.equal(applySessionName(sessions, "", "新名称"), sessions, "无会话路径时原样返回");

// 4. 之前为空的会话被命名后不再标记为空
const empty = [{ path: "x.jsonl", title: "新会话", empty: true }];
assert.equal(applySessionName(empty, "x.jsonl", "有名字")[0].empty, false, "命名后不应仍是空会话");

// 5. 键规范化
assert.equal(sessionKey("C:\\A\\B.jsonl"), sessionKey("c:/a/b.jsonl"));
assert.equal(sessionKey(""), "__default__");

console.log("session-title-apply OK");
