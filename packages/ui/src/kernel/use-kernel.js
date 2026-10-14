import { inject } from "vue";
import { KERNEL_KEY } from "./index.js";

export function useKernel() {
  const kernel = inject(KERNEL_KEY);
  if (!kernel) throw new Error("Pi Desktop kernel 未注入");
  return kernel;
}
