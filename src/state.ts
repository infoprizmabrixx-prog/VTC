// Shared state for the signed-in session. Screens read from here; app.ts owns
// navigation and fills in `go` / `refreshMe` at start-up.
// Synced with Zustand for global reactive state management.

import { create } from "zustand";

export interface PortalState {
  me: any;
  view: string;
  sub: any;
  data: Record<string, any>;
  arranging: boolean;
  pending?: any;
  crumb?: any;
  saved?: any;
  insights?: any;
  [key: string]: any;
}

export const usePortalStore = create<{
  view: string;
  me: any;
  arranging: boolean;
  sync: (patch: Partial<PortalState>) => void;
}>((set) => ({
  view: "dashboard",
  me: null,
  arranging: false,
  sync: (patch) => set((prev) => ({ ...prev, ...patch })),
}));

export const S: PortalState = {
  me: null,          // /me response: user, perms, modules, prefs, settings
  view: "dashboard", // current module key
  sub: null,         // optional sub-page (e.g. admin tab, person id)
  data: {},          // data loaded for the current screen
  arranging: false,  // v1.5: home screen in arrange mode (arrange.js)
};

export const can = (perm: string): boolean => !!S.me?.perms?.includes(perm);
export const tier = (): string | undefined => S.me?.user?.tier;

export const nav: {
  go: (view?: any, sub?: any) => Promise<any>;
  refreshMe: () => Promise<any>;
  rerender: () => Promise<any>;
} = {
  go: async (_view?: any, _sub?: any) => {},
  refreshMe: async () => {},
  rerender: async () => {},
};
