"use client";

import { createContext, useContext, useEffect, useRef } from "react";

export type ToastTone = "error" | "info";

export interface Toast {
  id: number;
  message: string;
  tone: ToastTone;
}

export interface ToastApi {
  toasts: Toast[];
  showToast: (message: string, tone?: ToastTone) => void;
  showError: (message: string) => void;
  dismissToast: (id: number) => void;
}

export const ToastContext = createContext<ToastApi | null>(null);

export const TOAST_TIMEOUT_MS = 7000;

export function useToast(): ToastApi {
  const api = useContext(ToastContext);

  if (!api) {
    throw new Error("useToast must be used inside a ToastProvider");
  }

  return api;
}

export function useErrorToast(state: { status: string; message?: string }) {
  const { showError } = useToast();
  const reported = useRef<unknown>(null);

  useEffect(() => {
    if (state.status !== "error" || reported.current === state) {
      return;
    }

    reported.current = state;

    if (state.message) {
      showError(state.message);
    }
  }, [state, showError]);
}
