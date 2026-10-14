import { reactive } from "vue";

export interface MenuItem {
  label?: string;
  icon?: string;
  hint?: string;
  danger?: boolean;
  disabled?: boolean;
  separator?: boolean;
  run?: () => void;
}

export interface ConfirmState {
  title: string;
  message: string;
  confirmLabel: string;
  danger: boolean;
  check: { label: string; value: boolean } | null;
  resolve: (result: { checked: boolean } | null) => void;
}

export const ui = reactive<{
  menu: { x: number; y: number; items: MenuItem[] } | null;
  confirm: ConfirmState | null;
}>({
  menu: null,
  confirm: null,
});

export function openMenu(event: MouseEvent, items: MenuItem[]): void {
  event.preventDefault();
  event.stopPropagation();
  const rect = (event.currentTarget as HTMLElement | null)?.getBoundingClientRect?.();
  const fromButton = event.type === "click" && rect;
  ui.menu = {
    x: fromButton ? rect.left : event.clientX,
    y: fromButton ? rect.bottom + 4 : event.clientY,
    items,
  };
}

export function closeMenu(): void {
  ui.menu = null;
}

export function askConfirm({
  title,
  message = "",
  confirmLabel = "确定",
  danger = false,
  check = null,
}: {
  title: string;
  message?: string;
  confirmLabel?: string;
  danger?: boolean;
  check?: { label: string; value: boolean } | null;
}): Promise<{ checked: boolean } | null> {
  return new Promise((resolve) => {
    ui.confirm = { title, message, confirmLabel, danger, check: check ? { ...check } : null, resolve };
  });
}

export function settleConfirm(ok: boolean): void {
  const dialog = ui.confirm;
  if (!dialog) return;
  ui.confirm = null;
  dialog.resolve(ok ? { checked: Boolean(dialog.check?.value) } : null);
}
