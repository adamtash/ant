/**
 * UI Store
 * Manages UI state (navigation, modals, preferences)
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type PageId =
  | 'royal'
  | 'foraging'
  | 'archive'
  | 'nursery'
  | 'builders'
  | 'war'
  | 'seasonal'
  | 'pheromone'
  | 'logs'
  | 'genetic'
  | 'tunnels';


export interface Toast {
  id: string;
  type: 'success' | 'error' | 'warning' | 'info';
  title: string;
  message?: string;
  duration?: number;
  timestamp: number;
}

export interface Modal {
  id: string;
  type: string;
  props?: Record<string, unknown>;
}

export interface UIState {
  // Navigation
  currentPage: PageId;
  previousPage: PageId | null;
  sidebarCollapsed: boolean;

  // Canvas display
  showPheromoneHeatmap: boolean;
  showChamberLabels: boolean;
  showAntLabels: boolean;
  showGrid: boolean;
  animationsEnabled: boolean;

  // Modals
  activeModal: Modal | null;

  // Toasts
  toasts: Toast[];

  // Preferences
  theme: 'dark' | 'light';
  soundEnabled: boolean;
  tooltipsEnabled: boolean;
  compactMode: boolean;

  // Loading states
  isLoading: boolean;
  loadingMessage: string;

  // Actions
  navigateTo: (page: PageId) => void;
  goBack: () => void;
  toggleSidebar: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;

  // Canvas display toggles
  togglePheromoneHeatmap: () => void;
  toggleChamberLabels: () => void;
  toggleAntLabels: () => void;
  toggleGrid: () => void;
  toggleAnimations: () => void;

  // Modals
  openModal: (type: string, props?: Record<string, unknown>) => void;
  closeModal: () => void;

  // Toasts
  addToast: (toast: Omit<Toast, 'id' | 'timestamp'>) => void;
  removeToast: (id: string) => void;

  // Preferences
  setTheme: (theme: 'dark' | 'light') => void;
  toggleSound: () => void;
  toggleTooltips: () => void;
  toggleCompactMode: () => void;

  // Loading
  setLoading: (loading: boolean, message?: string) => void;
}

let toastIdCounter = 0;
let modalIdCounter = 0;

export const useUIStore = create<UIState>()(
  persist(
    (set, get) => ({
      // Initial state
      currentPage: 'royal',
      previousPage: null,
      sidebarCollapsed: false,
      showPheromoneHeatmap: false,
      showChamberLabels: true,
      showAntLabels: false,
      showGrid: false,
      animationsEnabled: true,
      activeModal: null,
      toasts: [],
      theme: 'dark',
      soundEnabled: false,
      tooltipsEnabled: true,
      compactMode: false,
      isLoading: false,
      loadingMessage: '',

      // Navigation
      navigateTo: (page: PageId) => {
        set({
          previousPage: get().currentPage,
          currentPage: page,
        });
      },

      goBack: () => {
        const { previousPage } = get();
        if (previousPage) {
          set({
            currentPage: previousPage,
            previousPage: null,
          });
        }
      },

      toggleSidebar: () => {
        set({ sidebarCollapsed: !get().sidebarCollapsed });
      },

      setSidebarCollapsed: (collapsed: boolean) => {
        set({ sidebarCollapsed: collapsed });
      },

      // Canvas display toggles
      togglePheromoneHeatmap: () => {
        set({ showPheromoneHeatmap: !get().showPheromoneHeatmap });
      },

      toggleChamberLabels: () => {
        set({ showChamberLabels: !get().showChamberLabels });
      },

      toggleAntLabels: () => {
        set({ showAntLabels: !get().showAntLabels });
      },

      toggleGrid: () => {
        set({ showGrid: !get().showGrid });
      },

      toggleAnimations: () => {
        set({ animationsEnabled: !get().animationsEnabled });
      },

      // Modals
      openModal: (type: string, props?: Record<string, unknown>) => {
        set({
          activeModal: {
            id: `modal-${++modalIdCounter}`,
            type,
            props,
          },
        });
      },

      closeModal: () => {
        set({ activeModal: null });
      },

      // Toasts
      addToast: (toast) => {
        const id = `toast-${++toastIdCounter}`;
        const newToast: Toast = {
          ...toast,
          id,
          timestamp: Date.now(),
          duration: toast.duration ?? 5000,
        };

        set({ toasts: [...get().toasts, newToast] });

        // Auto-remove after duration
        if (newToast.duration && newToast.duration > 0) {
          setTimeout(() => {
            get().removeToast(id);
          }, newToast.duration);
        }
      },

      removeToast: (id: string) => {
        set({ toasts: get().toasts.filter((t) => t.id !== id) });
      },

      // Preferences
      setTheme: (theme: 'dark' | 'light') => {
        set({ theme });
        // Apply to document
        document.documentElement.classList.toggle('dark', theme === 'dark');
      },

      toggleSound: () => {
        set({ soundEnabled: !get().soundEnabled });
      },

      toggleTooltips: () => {
        set({ tooltipsEnabled: !get().tooltipsEnabled });
      },

      toggleCompactMode: () => {
        set({ compactMode: !get().compactMode });
      },

      // Loading
      setLoading: (loading: boolean, message?: string) => {
        set({
          isLoading: loading,
          loadingMessage: message ?? '',
        });
      },
    }),
    {
      name: 'ant-ui-preferences',
      partialize: (state) => ({
        theme: state.theme,
        soundEnabled: state.soundEnabled,
        tooltipsEnabled: state.tooltipsEnabled,
        compactMode: state.compactMode,
        sidebarCollapsed: state.sidebarCollapsed,
        showPheromoneHeatmap: state.showPheromoneHeatmap,
        showChamberLabels: state.showChamberLabels,
        showAntLabels: state.showAntLabels,
        showGrid: state.showGrid,
        animationsEnabled: state.animationsEnabled,
      }),
    }
  )
);
