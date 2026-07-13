import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      // Next.js 서버 전용 가드는 테스트 노드 환경에서 import 시 throw하므로 빈 모듈로 대체
      "server-only": path.resolve(__dirname, "src/test/empty-module.ts"),
      "client-only": path.resolve(__dirname, "src/test/empty-module.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
