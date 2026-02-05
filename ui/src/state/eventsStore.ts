import { create } from "zustand";
import type { SystemEvent } from "../api/types";

const MAX_EVENTS = 2000;

type EventsState = {
  events: SystemEvent[];
  push: (event: SystemEvent) => void;
  clear: () => void;
};

export const useEventsStore = create<EventsState>((set, get) => ({
  events: [],
  push: (event) => {
    const next = [...get().events, event];
    const overflow = next.length - MAX_EVENTS;
    set({ events: overflow > 0 ? next.slice(overflow) : next });
  },
  clear: () => set({ events: [] }),
}));

