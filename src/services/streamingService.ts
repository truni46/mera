import type { QuotaStatus } from '../types';

const API_BASE_URL: string = import.meta.env.VITE_API_URL || 'http://localhost:3000/api/v1';

interface Source {
    filename: string;
    pageNumber?: number;
}

type OnChunk = (chunk: string) => void;
type OnComplete = (fullResponse: string) => void;
type OnError = (error: Error) => void;
type OnAgentTask = (taskId: string) => void;
type OnQuota = (quota: QuotaStatus, isExceeded: boolean) => void;
type OnSources = (sources: Source[]) => void;
type OnTitle = (title: string) => void;
type OnThinking = (chunk: string) => void;

class StreamingService {
    private _abortController: AbortController | null = null;

    async sendMessage(
        message: string,
        conversationId: string | null,
        onChunk: OnChunk,
        onComplete: OnComplete,
        onError: OnError,
        onAgentTask: OnAgentTask,
        onQuota: OnQuota,
        documentIds: string[] | null = null,
        onSources: OnSources | null = null,
        onTitle: OnTitle | null = null,
        onThinking: OnThinking | null = null
    ): Promise<void> {
        try {
            this._abortController = new AbortController();

            const token = localStorage.getItem('accessToken');
            const headers: Record<string, string> = { 'Content-Type': 'application/json' };
            if (token) headers['Authorization'] = `Bearer ${token}`;

            const payload: { message: string; conversationId: string | null; documentIds?: string[] } = { message, conversationId };
            if (documentIds && documentIds.length > 0) {
                payload.documentIds = documentIds;
            }

            const response = await fetch(`${API_BASE_URL}/messages/chat/completions`, {
                method: 'POST',
                headers,
                body: JSON.stringify(payload),
                signal: this._abortController.signal,
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            if (!response.body) {
                throw new Error('No response body');
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';

            while (true) {
                const { done, value } = await reader.read();

                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n\n');
                buffer = lines.pop() ?? '';

                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        try {
                            const data = JSON.parse(line.slice(6));

                            if (data.quotaExceeded && onQuota) {
                                onQuota(data.quota, true);
                                return;
                            }

                            if (data.agentTask && onAgentTask) {
                                onAgentTask(data.taskId);
                                return;
                            }

                            if (data.error) {
                                onError(new Error(data.error));
                                return;
                            }

                            if (data.thinking && onThinking) {
                                onThinking(data.thinking);
                            }

                            if (data.chunk) {
                                onChunk(data.chunk);
                            }

                            if (data.title) {
                                if (onTitle) onTitle(data.title);
                            }

                            if (data.done) {
                                if (data.quota && onQuota) {
                                    onQuota(data.quota, false);
                                }
                                let finalResponse: string = data.fullResponse || '';
                                if (data.sources && data.sources.length > 0) {
                                    if (onSources) onSources(data.sources);
                                    const seen = new Set<string>();
                                    const unique: Source[] = data.sources.filter((s: Source) => {
                                        if (!s.filename) return false;
                                        const key = `${s.filename}|${s.pageNumber ?? ''}`;
                                        if (seen.has(key)) return false;
                                        seen.add(key);
                                        return true;
                                    });
                                    if (unique.length > 0) {
                                        const refLines = unique.map(s => {
                                            const pageAttr = s.pageNumber ? ` page="${s.pageNumber}"` : '';
                                            const label = s.pageNumber ? `${s.filename} (trang ${s.pageNumber})` : s.filename;
                                            return `<docref file="${s.filename}"${pageAttr}>${label}</docref>`;
                                        });
                                        finalResponse += '\n\n---\n**Nguồn tham khảo:**\n' + refLines.join('\n');
                                    }
                                }
                                onComplete(finalResponse);
                            }
                        } catch (err) {
                            console.error('Error parsing SSE data:', err);
                        }
                    }
                }
            }
        } catch (error) {
            if (!(error instanceof Error && error.name === 'AbortError')) {
                console.error('Streaming error:', error);
            }
            onError(error instanceof Error ? error : new Error(String(error)));
        } finally {
            this._abortController = null;
        }
    }

    cancel(): void {
        if (this._abortController) {
            this._abortController.abort();
            this._abortController = null;
        }
    }
}

export default new StreamingService();
