"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";

import { TOAST_TIMEOUT_MS, ToastContext, type Toast, type ToastTone } from "@/lib/useToast";

import { EASE } from "./motion";

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const lastId = useRef(0);

  const dismissToast = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const showToast = useCallback((message: string, tone: ToastTone = "info") => {
    lastId.current += 1;
    const id = lastId.current;
    setToasts((current) => [...current, { id, message, tone }]);
  }, []);

  const showError = useCallback(
    (message: string) => {
      showToast(message, "error");
    },
    [showToast],
  );

  const api = useMemo(
    () => ({ toasts, showToast, showError, dismissToast }),
    [toasts, showToast, showError, dismissToast],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}

      <div className="toasts" role="region" aria-label="Notifications">
        <AnimatePresence initial={false}>
          {toasts.map((toast) => (
            <ToastCard key={toast.id} toast={toast} onDismiss={dismissToast} />
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}

function ToastCard({ toast, onDismiss }: { toast: Toast; onDismiss: (id: number) => void }) {
  useEffect(() => {
    const timer = setTimeout(() => onDismiss(toast.id), TOAST_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [toast.id, onDismiss]);

  const isError = toast.tone === "error";

  return (
    <motion.div
      layout
      className={isError ? "toast toast-error" : "toast"}
      role={isError ? "alert" : "status"}
      initial={{ opacity: 0, x: 40, scale: 0.96 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={{ opacity: 0, x: 40, scale: 0.96, transition: { duration: 0.2, ease: EASE } }}
      transition={{ type: "spring", stiffness: 380, damping: 32 }}
      drag="x"
      dragConstraints={{ left: 0, right: 0 }}
      dragElastic={{ left: 0.02, right: 0.6 }}
      onDragEnd={(event, info) => {
        if (info.offset.x > 80) {
          onDismiss(toast.id);
        }
      }}
    >
      <p>
        <span className="toast-label">{isError ? "Error" : "Notice"}</span>
        {toast.message}
      </p>

      <button type="button" onClick={() => onDismiss(toast.id)} aria-label="Dismiss">
        &times;
      </button>

      <motion.span
        className="toast-timer"
        aria-hidden="true"
        initial={{ scaleX: 1 }}
        animate={{ scaleX: 0 }}
        transition={{ duration: TOAST_TIMEOUT_MS / 1000, ease: "linear" }}
      />
    </motion.div>
  );
}
