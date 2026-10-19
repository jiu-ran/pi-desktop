import { inject } from "vue";
import { KERNEL_KEY, type PiDesktopKernel } from "./index.ts";

export function useKernel(): PiDesktopKernel {
  const kernel = inject<PiDesktopKernel>(KERNEL_KEY);
  if (!kernel) throw new Error("Pi Desktop kernel 未注入");
  return kernel;
}
