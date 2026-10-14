import { inject } from "vue";
import { KERNEL_KEY } from "./index.ts";

export function useKernel(): any {
  const kernel = inject(KERNEL_KEY);
  if (!kernel) throw new Error("Pi Desktop kernel 未注入");
  return kernel;
}
