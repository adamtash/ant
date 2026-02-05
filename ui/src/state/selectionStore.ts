import { create } from "zustand";

export type SelectedEntity =
  | { type: "task"; id: string; sessionKey?: string }
  | { type: "subagent"; id: string; sessionKey?: string }
  | { type: "error"; id: string }
  | { type: "job"; id: string }
  | { type: "session"; id: string }
  | { type: "skill"; id: string }
  | { type: "provider"; id: string }
  | { type: "memory"; id: string };

type SelectionState = {
  selected: SelectedEntity | null;
  select: (next: SelectedEntity | null) => void;
  clear: () => void;
};

export const useSelectionStore = create<SelectionState>((set) => ({
  selected: null,
  select: (next) => set({ selected: next }),
  clear: () => set({ selected: null }),
}));

