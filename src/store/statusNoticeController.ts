import type { StatusNoticeAction } from "./storePayloads";
import type { StoreGet, StoreSet } from "./types";

export interface StatusNoticeController {
  emitNotice: (
    message: string,
    kind?: "info" | "success" | "error",
    action?: StatusNoticeAction
  ) => void;
  clearStatusNotice: () => void;
  pauseStatusNotice: () => void;
  resumeStatusNotice: () => void;
}

export function createStatusNoticeController(
  set: StoreSet,
  get: StoreGet
): StatusNoticeController {
  let dismissTimer: ReturnType<typeof setTimeout> | null = null;
  let activeSeq = 0;
  let remainingMs = 0;
  let startedAt = 0;
  let paused = false;

  const stopTimer = () => {
    if (dismissTimer !== null) {
      clearTimeout(dismissTimer);
      dismissTimer = null;
    }
  };

  const armTimer = (seq: number, delayMs: number) => {
    stopTimer();
    activeSeq = seq;
    remainingMs = Math.max(800, delayMs);
    startedAt = Date.now();
    paused = false;
    dismissTimer = setTimeout(() => {
      dismissTimer = null;
      remainingMs = 0;
      if (get().statusNotice?.seq === seq) {
        set({ statusNotice: null });
      }
    }, remainingMs);
  };

  return {
    emitNotice: (message, kind = "info", action) => {
      stopTimer();
      const seq = (get().statusNotice?.seq || 0) + 1;
      set({
        statusMessage: message,
        statusNotice: {
          message,
          kind,
          seq,
          ...(action
            ? { actionLabel: action.label, onAction: action.onClick }
            : {}),
        },
      });
      armTimer(seq, action ? 6500 : 4200);
    },

    clearStatusNotice: () => {
      stopTimer();
      remainingMs = 0;
      paused = false;
      set({ statusNotice: null });
    },

    pauseStatusNotice: () => {
      if (paused || dismissTimer === null) return;
      const elapsed = Math.max(0, Date.now() - startedAt);
      remainingMs = Math.max(1200, remainingMs - elapsed);
      stopTimer();
      paused = true;
    },

    resumeStatusNotice: () => {
      if (!paused) return;
      paused = false;
      const live = get().statusNotice;
      if (!live || live.seq !== activeSeq) return;
      armTimer(activeSeq, remainingMs || 2400);
    },
  };
}
