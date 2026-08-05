import { useState, useEffect } from 'react';

/**
 * Shows spinner only if loading takes longer than `delay` ms.
 * Prevents flash of loading state for fast operations.
 */
export function useDelayedSpinner(isLoading: boolean, delay = 200): boolean {
    const [showSpinner, setShowSpinner] = useState(false);

    useEffect(() => {
        if (!isLoading) {
            setShowSpinner(false);
            return;
        }
        const timer = setTimeout(() => setShowSpinner(true), delay);
        return () => clearTimeout(timer);
    }, [isLoading, delay]);

    return showSpinner;
}
