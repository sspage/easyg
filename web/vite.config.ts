import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": {
        target: "http://127.0.0.1:5001/white-dispatch-481617-f8/us-central1",
        changeOrigin: true,
      },
    },
  },
});
