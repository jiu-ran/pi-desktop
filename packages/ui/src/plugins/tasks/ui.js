import { reactive } from "vue";

/**
 * 任务导航的浮层状态：右键菜单与确认弹窗。
 * 两者都作为 overlays 贡献，挂在骨架最上层，不受侧栏 overflow 裁剪。
 */
export const ui = reactive({
  /** { x, y, items: [{ label, icon?, danger?, disabled?, run }] | { separator: true } } */
  menu: null,
  /** { title, message, confirmLabel, danger, check?: { label, value }, resolve } */
  confirm: null,
});

export function openMenu(event, items) {
  event.preventDefault();
  event.stopPropagation();
  const rect = event.currentTarget?.getBoundingClientRect?.();
  // 从「⋯」按钮打开时贴在按钮下方，右键打开时跟随鼠标
  const fromButton = event.type === "click" && rect;
  ui.menu = {
    x: fromButton ? rect.left : event.clientX,
    y: fromButton ? rect.bottom + 4 : event.clientY,
    items,
  };
}

export function closeMenu() {
  ui.menu = null;
}

/** 弹出确认框。返回 null 表示取消；否则返回 { checked }。 */
export function askConfirm({ title, message = "", confirmLabel = "确定", danger = false, check = null }) {
  return new Promise((resolve) => {
    ui.confirm = { title, message, confirmLabel, danger, check: check ? { ...check } : null, resolve };
  });
}

export function settleConfirm(ok) {
  const dialog = ui.confirm;
  if (!dialog) return;
  ui.confirm = null;
  dialog.resolve(ok ? { checked: Boolean(dialog.check?.value) } : null);
}
