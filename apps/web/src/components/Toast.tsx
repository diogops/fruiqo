import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';

interface ToastAction {
  label: string;
  onClick: () => void | Promise<void>;
}

interface Toast {
  id: number;
  message: string;
  tone: 'info' | 'error';
  action?: ToastAction;
}

interface ToastValue {
  show: (message: string, opts?: { tone?: 'info' | 'error'; action?: ToastAction; timeoutMs?: number }) => void;
}

const ToastContext = createContext<ToastValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);

  const show = useCallback<ToastValue['show']>(
    (message, opts = {}) => {
      const id = nextId.current++;
      setToasts((t) => [...t, { id, message, tone: opts.tone ?? 'info', action: opts.action }]);
      window.setTimeout(() => dismiss(id), opts.timeoutMs ?? (opts.action ? 10_000 : 5_000));
    },
    [dismiss],
  );

  return (
    <ToastContext.Provider value={{ show }}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.tone}`}>
            <span>{t.message}</span>
            {t.action && (
              <button
                type="button"
                className="btn btn-link"
                onClick={async () => {
                  dismiss(t.id);
                  await t.action?.onClick();
                }}
              >
                {t.action.label}
              </button>
            )}
            <button type="button" className="btn btn-icon" aria-label="Fechar aviso" onClick={() => dismiss(t.id)}>
              ×
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast fora do ToastProvider');
  return ctx;
}
