import { useState, useRef, useEffect, useCallback } from 'react';

interface UseViewerParams {
    viewingDocument?: { doc?: { id?: string } } | null;
}

export default function useViewer({ viewingDocument }: UseViewerParams) {
    const [viewerWidth, setViewerWidth] = useState(400);

    const splitPaneRef = useRef<HTMLDivElement>(null);
    const viewerRef = useRef<HTMLDivElement>(null);
    const isResizing = useRef(false);

    const docId = viewingDocument?.doc?.id;

    const startResizing = useCallback(() => {
        isResizing.current = true;
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
    }, []);

    const stopResizing = useCallback(() => {
        if (isResizing.current) {
            isResizing.current = false;
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
            if (viewerRef.current) {
                const finalWidth = parseInt(viewerRef.current.style.width, 10);
                if (!isNaN(finalWidth)) setViewerWidth(finalWidth);
            }
        }
    }, []);

    const resize = useCallback((e: MouseEvent) => {
        if (!isResizing.current || !splitPaneRef.current) return;
        const containerRect = splitPaneRef.current.getBoundingClientRect();
        let newWidth = containerRect.right - e.clientX;
        if (newWidth < 200) newWidth = 200;
        if (newWidth > 800) newWidth = 800;
        if (viewerRef.current) {
            viewerRef.current.style.width = `${newWidth}px`;
        }
    }, []);

    useEffect(() => {
        window.addEventListener('mousemove', resize);
        window.addEventListener('mouseup', stopResizing);
        return () => {
            window.removeEventListener('mousemove', resize);
            window.removeEventListener('mouseup', stopResizing);
        };
    }, [resize, stopResizing]);

    useEffect(() => {
        if (!docId || !splitPaneRef.current) return;
        const containerWidth = splitPaneRef.current.offsetWidth;
        setViewerWidth(Math.round(containerWidth * 0.45));
    }, [docId]);

    return {
        viewerWidth,
        splitPaneRef,
        viewerRef,
        startResizing,
    };
}