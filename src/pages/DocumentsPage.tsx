import { useState, useCallback } from 'react';
import DocumentUploadZone from '../components/document/DocumentUploadZone';
import DocumentTable from '../components/document/DocumentTable';
import Breadcrumb, { type BreadcrumbItem } from '../components/document/Breadcrumb';

const ROOT_CRUMB: BreadcrumbItem = { id: null, name: 'Documents' };

export default function DocumentsPage() {
    const [refreshTrigger, setRefreshTrigger] = useState(0);
    const [crumbs, setCrumbs] = useState<BreadcrumbItem[]>([ROOT_CRUMB]);

    const currentFolderId = crumbs.length > 0 ? crumbs[crumbs.length - 1].id : null;

    const handleNavigateFolder = useCallback((folderId: string, name: string) => {
        setCrumbs(prev => [...prev, { id: folderId, name }]);
        setRefreshTrigger(t => t + 1);
    }, []);

    const handleBreadcrumbNavigate = useCallback((id: string | null) => {
        setCrumbs(prev => {
            const index = prev.findIndex(c => c.id === id);
            if (index === -1) return [ROOT_CRUMB];
            return prev.slice(0, index + 1);
        });
        setRefreshTrigger(t => t + 1);
    }, []);

    return (
        <div className="flex-1 flex flex-col h-full overflow-hidden p-3">
            <div className="flex flex-col flex-1 bg-app-bg rounded-2xl overflow-hidden">
                <main className="flex-1 overflow-y-auto p-8">
                    <div className="max-w-5xl mx-auto space-y-8">
                        <Breadcrumb items={crumbs} onNavigate={handleBreadcrumbNavigate} />
                        <DocumentUploadZone
                            onUploadComplete={() => setRefreshTrigger(t => t + 1)}
                            folderId={currentFolderId}
                        />
                        <DocumentTable
                            refreshTrigger={refreshTrigger}
                            folderId={currentFolderId}
                            onNavigateFolder={handleNavigateFolder}
                        />
                    </div>
                </main>
            </div>
        </div>
    );
}
