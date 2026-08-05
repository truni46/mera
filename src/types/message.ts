export interface ChatMessage {
    role: 'user' | 'assistant' | 'system';
    content: string;
    createdAt?: string;
    /** Legacy fallback field some older messages use instead of createdAt. */
    timestamp?: string;
    model?: string;
    parentId?: string;
    metadata?: Record<string, unknown>;
    thinking?: string | null;
    thinkingDuration?: number | null;
}
