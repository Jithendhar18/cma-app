import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

interface UiStore {
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
}

export const useUiStore = create<UiStore>()(
  persist(
    (set) => ({
      sidebarCollapsed: false,
      toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
    }),
    { name: 'cma-study-os-ui', storage: createJSONStorage(() => localStorage) },
  ),
);
