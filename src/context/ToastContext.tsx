import { createContext, useContext, useState, useCallback, useRef, type ReactNode } from 'react';

export type ToastType = 'success' | 'info' | 'error';

export interface Toast {
    id: string;
    type: ToastType;
    title: string;
    description?: string;
    isExiting: boolean;
}

interface ShowToastOptions {
    type?: ToastType;
    title: string;
    description?: string;
    duration?: number;
}

interface ToastContextValue {
    toasts: Toast[];
    showToast: (options: ShowToastOptions) => string;
    success: (title: string, description?: string) => string;
    info: (title: string, description?: string) => string;
    error: (title: string, description?: string) => string;
    dismiss: (id: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);
const MAX_TOASTS = 5;
const DEFAULT_DURATION = 2000;
const EXIT_ANIMATION_MS = 200;

export const ToastProvider = ({ children }: { children: ReactNode }) => {
    const [toasts, setToasts] = useState<Toast[]>([]);
    const timersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

    const dismiss = useCallback((id: string) => {
        setToasts((prev) =>
            prev.map((t) => (t.id === id ? { ...t, isExiting: true } : t))
        );
        setTimeout(() => {
            setToasts((prev) => prev.filter((t) => t.id !== id));
        }, EXIT_ANIMATION_MS);

        if (timersRef.current[id]) {
            clearTimeout(timersRef.current[id]);
            delete timersRef.current[id];
        }
    }, []);

    const showToast = useCallback(({ type = 'info', title, description, duration = DEFAULT_DURATION }: ShowToastOptions): string => {
        const id = Date.now() + '-' + Math.random().toString(36).slice(2, 9);
        const newToast: Toast = { id, type, title, description, isExiting: false };

        setToasts((prev) => {
            const next = [...prev, newToast];
            if (next.length > MAX_TOASTS) {
                const oldest = next[0];
                dismiss(oldest.id);
                return next.slice(1);
            }
            return next;
        });

        timersRef.current[id] = setTimeout(() => {
            dismiss(id);
            delete timersRef.current[id];
        }, duration);

        return id;
    }, [dismiss]);

    const success = useCallback((title: string, description?: string) => {
        return showToast({ type: 'success', title, description });
    }, [showToast]);

    const info = useCallback((title: string, description?: string) => {
        return showToast({ type: 'info', title, description });
    }, [showToast]);

    const error = useCallback((title: string, description?: string) => {
        return showToast({ type: 'error', title, description });
    }, [showToast]);

    return (
        <ToastContext.Provider value={{ toasts, showToast, success, info, error, dismiss }}>
            {children}
        </ToastContext.Provider>
    );
};

export const useToast = (): ToastContextValue => {
    const context = useContext(ToastContext);
    if (!context) {
        throw new Error('useToast must be used within a ToastProvider');
    }
    return context;
};
