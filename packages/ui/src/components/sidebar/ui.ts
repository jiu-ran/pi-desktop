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

export interface PromptState {
  title: string;
  message: string;
  label: string;
  value: string;
  placeholder: string;
  confirmLabel: string;
  resolve: (value: string | null) => void;
}

export const sidebarUi = reactive<{
  menu: { x: number; y: number; items: MenuItem[] } | null;
  confirm: ConfirmState | null;
  prompt: PromptState | null;
}>({
  menu: null,
  confirm: null,
  prompt: null,
});

export function openMenu(event: MouseEvent, items: MenuItem[]): void {
  event.preventDefault();
  event.stopPropagation();
  const rect = (event.currentTarget as HTMLElement | null)?.getBoundingClientRect?.();
  const fromButton = event.type === "click" && rect;
  sidebarUi.menu = {
    x: fromButton ? rect.left : event.clientX,
    y: fromButton ? rect.bottom + 4 : event.clientY,
    items,
  };
}

export function closeMenu(): void {
  sidebarUi.menu = null;
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
    sidebarUi.confirm = { title, message, confirmLabel, danger, check: check ? { ...check } : null, resolve };
  });
}

export function settleConfirm(ok: boolean): void {
  const dialog = sidebarUi.confirm;
  if (!dialog) return;
  sidebarUi.confirm = null;
  dialog.resolve(ok ? { checked: Boolean(dialog.check?.value) } : null);
}

export function askPrompt({
  title,
  message = "",
  label = "名称",
  value = "",
  placeholder = "",
  confirmLabel = "确定",
}: {
  title: string;
  message?: string;
  label?: string;
  value?: string;
  placeholder?: string;
  confirmLabel?: string;
}): Promise<string | null> {
  return new Promise((resolve) => {
    sidebarUi.prompt = { title, message, label, value, placeholder, confirmLabel, resolve };
  });
}

export function settlePrompt(ok: boolean): void {
  const dialog = sidebarUi.prompt;
  if (!dialog) return;
  sidebarUi.prompt = null;
  const value = dialog.value.trim();
  dialog.resolve(ok && value ? value : null);
}
