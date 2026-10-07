import { useSyncExternalStore } from 'react';

/** How long YouTube's own controls stay switched on before they're forced off again. */
export const YT_CONTROLS_MS = 10_000;

/** Tiny store so overlay buttons / shortcuts can control the single player instance. */
let paused = false;
/**
 * Whether YouTube's own controls (control bar, title, gear menu) are switched on. Off by default;
 * "Change YouTube video settings" turns them on, and they always switch off again after
 * YT_CONTROLS_MS, whatever the mouse is doing.
 */
let ytControls = false;
let ytControlsUntil = 0;
let ytTimer: ReturnType<typeof setTimeout> | null = null;
let toggleImpl: (() => void) | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => (listeners.add(l), () => listeners.delete(l));

export const playerStore = {
  register(toggle: () => void) {
    toggleImpl = toggle;
  },
  setPaused(value: boolean) {
    if (paused === value) return;
    paused = value;
    notify();
  },
  togglePause() {
    toggleImpl?.();
  },
  setYtControls(value: boolean) {
    if (ytTimer) clearTimeout(ytTimer);
    ytTimer = null;
    ytControlsUntil = value ? Date.now() + YT_CONTROLS_MS : 0;
    // Failsafe: always switch off again, no matter what.
    if (value) ytTimer = setTimeout(() => playerStore.setYtControls(false), YT_CONTROLS_MS);
    if (ytControls === value) return;
    ytControls = value;
    notify();
  },
  get ytControls() {
    return ytControls;
  },
  get ytControlsUntil() {
    return ytControlsUntil;
  },
};

export function usePaused(): boolean {
  return useSyncExternalStore(subscribe, () => paused);
}

export function useYtControls(): boolean {
  return useSyncExternalStore(subscribe, () => ytControls);
}
