# Pi 兼容记录

记录桌面端为适配当前 Pi 版本而保留的行为。升级 `package.json` 中的 `@earendil-works/pi-coding-agent` 时，必须同时复查每一项。

## 当前版本

- Pi 包版本：`1.2.0`
- 通信方式：本机 `pi --mode rpc` 与官方 `RpcClient`
- 白名单：`electron/pi-rpc-allowlist.ts`

## 适配项

| 适配 | 位置 | 原因 | 删除条件 |
|---|---|---|---|
| 使用 RPC 而非进程内 SDK 会话 | `electron/pi-host.ts` | 保持桌面端与 Pi 进程隔离 | Pi 提供受支持的嵌入式主机 API 且产品决定改变运行方式 |
| 使用 `DefaultResourceLoader` 发现 Skills | `electron/pi-host.ts` | 普通 `loadSkills` 不扫描 Pi 实际使用的全部 Skills 目录 | Pi 公开稳定的完整 Skills 发现 API |
| 附件在发送前转换为文件和图片内容 | `electron/pi-host.ts` | 当前 RPC 提示接口接收文本和图片，不接收桌面端附件对象 | Pi 提示接口原生支持受控文件附件 |
| 界面缓存派生自 RPC 快照和事件 | `packages/ui/src/kernel` | 界面需要立即响应，但不能变成第二份会话记录 | 界面能直接订阅 Pi 的完整只读状态并仍满足响应要求 |
