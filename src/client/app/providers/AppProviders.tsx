import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { AdminLocaleProvider } from "../../shared/i18n/AdminLocaleProvider.tsx";
import { AdminToastViewport } from "../../shared/ui/AdminToastViewport.tsx";

export function AppProviders({ children, queryClient }: { children: ReactNode; queryClient: QueryClient }) {
  return (
    <QueryClientProvider client={queryClient}>
      <AdminLocaleProvider>
        {children}
        <AdminToastViewport />
      </AdminLocaleProvider>
    </QueryClientProvider>
  );
}
