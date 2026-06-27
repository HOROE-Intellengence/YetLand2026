import { create } from 'zustand';
import type { DrawerId } from '../components/drawer';

interface DrawerStoreState {
  openId: DrawerId | null;
  open: (id: DrawerId) => void;
  close: () => void;
}

export const useDrawerStore = create<DrawerStoreState>((set) => ({
  openId: null,
  open: (openId) => set({ openId }),
  close: () => set({ openId: null }),
}));
