import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Dev proxy target — uses Firebase emulator default format
const EMULATOR_PROJECT = process.env.VITE_PROJECT_ID || "white-dispatch-481617-f8";
const EMULATOR_REGION = "us-central1";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": {
        target: `http://127.0.0.1:5001/${EMULATOR_PROJECT}/${EMULATOR_REGION}`,
        changeOrigin: true,
      },
    },
  },
});
