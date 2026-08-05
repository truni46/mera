export interface ConversationSummary {
    id: string;
    title: string;
    projectId?: string | null;
    userId?: string;
    createdAt: string;
    updatedAt?: string;
    metadata?: Record<string, unknown>;
}
