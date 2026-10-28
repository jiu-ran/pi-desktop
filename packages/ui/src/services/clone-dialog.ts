import { reactive } from "vue";

/** 「从 Git 克隆」弹窗的全局开关（项目菜单与欢迎页都指向这里）。 */
export const cloneDialogState = reactive({
  open: false,
});

export function openCloneDialog(): void {
  cloneDialogState.open = true;
}

export function closeCloneDialog(): void {
  cloneDialogState.open = false;
}
