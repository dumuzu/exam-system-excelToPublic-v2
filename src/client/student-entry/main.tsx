import { StrictMode } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { StudentEntryIsland } from "./components/StudentEntryIsland.tsx";

const rootElement = document.querySelector<HTMLElement>("#studentEntryRoot");
if (!rootElement) throw new Error("Missing student entry React root.");

const queryClient = new QueryClient({
  defaultOptions: {
    mutations: { retry: false },
  },
});

// 先同步交付最终 DOM，再挂载旧考试控制器，避免事件绑定到被替换的节点。
flushSync(() => {
  createRoot(rootElement).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <StudentEntryIsland />
      </QueryClientProvider>
    </StrictMode>,
  );
});

document.documentElement.dataset["studentEntryReact"] = "ready";

const legacyExamModulePath = "/exam/exam.js";
void import(/* @vite-ignore */ legacyExamModulePath).catch(() => {
  const status = document.querySelector<HTMLElement>("#identity-message");
  if (status) status.textContent = "画面を読み込めませんでした。再読み込みしてください。";
});
