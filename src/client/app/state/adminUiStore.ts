import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

interface AdminUiState {
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
}

type PersistedAdminUiState = Pick<AdminUiState, "sidebarCollapsed">;

// 全局 Store 只保存跨路由 UI 偏好；服务端事实、权限、筛选和表单不得进入这里。
export const useAdminUiStore = create<AdminUiState>()(persist<AdminUiState, [], [], PersistedAdminUiState>(
  (set) => ({
    sidebarCollapsed: false,
    toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
  }),
  {
    name: "exam-admin-ui",
    storage: createJSONStorage(() => localStorage),
    partialize: (state) => ({ sidebarCollapsed: state.sidebarCollapsed }),
  },
));
