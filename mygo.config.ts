import { defineConfig } from "mygo-cli";
import pkg from "./package.json" with { type: "json" };

export default defineConfig({
  name: "Pi Desktop",
  slug: "pi-desktop",
  identifier: "dev.pi.desktop",
  version: pkg.version,
  copyright: "© 2026 jiu-ran",
  license: "MIT",

  // 前端仍然是 packages/ui 的 Vue 应用；MyGo 只负责窗口与宿主。
  devUrl: "http://127.0.0.1:1420",
  devCommand: "npm run dev --prefix packages/ui",
  buildCommand: "npm run build --prefix packages/ui",
  frontendDist: "packages/ui/dist",
  bindings: "packages/ui/src/mygo/bindings.ts",
  out: "dist-mygo",

  main: "./cmd/pi-desktop",
  icon: "build/icon.png",
  macos: {
    minimumSystemVersion: "13.0",
  },
  linux: {
    maintainer: "jiu-ran",
    categories: ["Development", "Utility"],
  },
});
