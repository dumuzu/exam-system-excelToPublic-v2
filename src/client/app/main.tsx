import { RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/noto-sans-jp/wght.css";

import { AppProviders } from "./providers/AppProviders.tsx";
import { queryClient, router } from "./router/router.tsx";
import "../shared/styles/tokens.css";
import "../shared/styles/base.css";
import "../shared/styles/components.css";
import "../shared/styles/toast.css";
import "../shared/styles/login.css";
import "../shared/styles/adminShell.css";
import "../shared/styles/dashboard.css";
import "../shared/styles/tables.css";
import "../shared/styles/examList.css";
import "../shared/styles/results.css";
import "../shared/styles/responsive.css";

const rootElement = document.querySelector<HTMLElement>("#reactRoot");
if (!rootElement) throw new Error("Missing React application root.");

createRoot(rootElement).render(
  <StrictMode>
    <AppProviders queryClient={queryClient}>
      <RouterProvider router={router} />
    </AppProviders>
  </StrictMode>,
);
