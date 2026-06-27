import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';

interface ToastItem { id: number; message: string; type: 'success' | 'error' }

interface ToastCtx {
  success: (msg: string) => void;
  error: (msg: string) => void;
}

const ToastContext = createContext<ToastCtx>({ success: () => {}, error: () => {} });

export function useToast() { return useContext(ToastContext); }

let nextId = 1;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const add = useCallback((message: string, type: 'success' | 'error') => {
    const id = nextId++;
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 3500);
  }, []);
  const ctx: ToastCtx = {
    success: (msg) => add(msg, 'success'),
    error: (msg) => add(msg, 'error'),
  };
  return (
    <ToastContext.Provider value={ctx}>
      {children}
      <div className="toast-container">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.type}`}>{t.message}</div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
