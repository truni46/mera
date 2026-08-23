import { useState, useEffect, useRef, useCallback } from 'react';
import conversationService from '../services/conversationService';
import apiService from '../services/apiService';
import streamingService from '../services/streamingService';
import agentStreamService from '../services/agentStreamService';
import websocketService from '../services/websocketService';
import documentService from '../services/documentService';
import logger from '../utils/logger';
import type { ChatMessage as ChatMessageType, DocumentItem, QuotaStatus } from '../types';
import type { AgentRunEvent, AgentDoneEvent } from '../services/agentStreamService';
import type { AppSettings } from '../layouts/ChatLayout';
import type { AgentStep } from '../components/chat/AgentTaskList';

const AGENT_NAME_MAP: Record<string, string> = {
    research: 'Research Agent',
    planner: 'Planning Agent',
    implement: 'Implementation Agent',
    testing: 'Testing Agent',
    report: 'Reporting Agent',
};

const SCROLL_THRESHOLD = 120;

export interface AgentGroup {
    id: string;
    agentType: string;
    agentName: string;
    steps: AgentStep[];
}

export interface ViewingDocument {
    doc: DocumentItem | { filename?: string; id?: string };
    pageStart?: string | null;
    pageEnd?: string | null;
}

export type SelectedDoc = DocumentItem & { active?: boolean };

interface UseChatMessagingParams {
    activeConversationId: string | null;
    setActiveConversationId: (id: string | null) => void;
    settings: AppSettings;
    loadConversations: () => Promise<void>;
}

export default function useChatMessaging({
    activeConversationId,
    setActiveConversationId,
    settings,
    loadConversations,
}: UseChatMessagingParams) {
    const [messages, setMessages] = useState<ChatMessageType[]>([]);
    const [messagesLoading, setMessagesLoading] = useState(false);
    const [isTyping, setIsTyping] = useState(false);
    const [isStreaming, setIsStreaming] = useState(false);
    const [streamingMessage, setStreamingMessage] = useState('');
    const [streamingThinking, setStreamingThinking] = useState<string | null>(null);
    const [thinkingDuration, setThinkingDuration] = useState<number | null>(null);
    const [agentGroups, setAgentGroups] = useState<AgentGroup[] | null>(null);
    const [quotaStatus, setQuotaStatus] = useState<QuotaStatus | null>(null);
    const [quotaWarning, setQuotaWarning] = useState(false);
    const [quotaBlocked, setQuotaBlocked] = useState(false);
    const [selectedDocs, setSelectedDocs] = useState<SelectedDoc[]>([]);
    const [viewingDocument, setViewingDocument] = useState<ViewingDocument | null>(null);

    const chatScrollRef = useRef<HTMLDivElement>(null);
    const userScrolledUp = useRef(false);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const justCreatedConversationId = useRef<string | null>(null);
    const draftDocsRef = useRef<Record<string, SelectedDoc[]>>({});
    const prevConvIdRef = useRef(activeConversationId);
    const thinkingTextRef = useRef('');
    const thinkingStartRef = useRef<number | null>(null);
    const thinkingDurationRef = useRef<number | null>(null);

    const handleChatScroll = useCallback(() => {
        const el = chatScrollRef.current;
        if (!el) return;
        const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
        userScrolledUp.current = distanceFromBottom > SCROLL_THRESHOLD;
    }, []);

    const scrollToBottom = useCallback(() => {
        if (!userScrolledUp.current) {
            messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
        }
    }, []);

    useEffect(() => {
        scrollToBottom();
    }, [messages, isTyping, streamingMessage, agentGroups, scrollToBottom]);

    useEffect(() => {
        return () => agentStreamService.cancel();
    }, []);

    useEffect(() => {
        if (settings.communication_mode === 'websocket') {
            connectWebSocket();
        } else {
            disconnectWebSocket();
        }
        return () => disconnectWebSocket();
    }, [settings.communication_mode]);

    useEffect(() => {
        if (activeConversationId) {
            if (activeConversationId === justCreatedConversationId.current) {
                justCreatedConversationId.current = null;
            } else {
                loadMessages(activeConversationId);
            }
        } else {
            setMessages([]);
            setMessagesLoading(false);
        }
        setAgentGroups(null);
        setViewingDocument(null);
    }, [activeConversationId]);

    useEffect(() => {
        const fetchQuota = async () => {
            try {
                const status = await apiService.get<QuotaStatus>(`/quota/status?conversationId=${activeConversationId || ''}`);
                setQuotaStatus(status);
                setQuotaBlocked(!status.allowed);
                setQuotaWarning(status.warning);
            } catch (error) {
                logger.error('Error fetching quota:', error);
            }
        };
        fetchQuota();
    }, [activeConversationId]);

    // Save/restore doc selection per conversation
    useEffect(() => {
        if (prevConvIdRef.current !== activeConversationId) {
            draftDocsRef.current[prevConvIdRef.current ?? ''] = selectedDocs;
            setSelectedDocs(draftDocsRef.current[activeConversationId ?? ''] || []);
            prevConvIdRef.current = activeConversationId;
        }
    }, [activeConversationId, selectedDocs]);

    const loadMessages = async (conversationId: string) => {
        setMessagesLoading(true);
        try {
            const msgs = await conversationService.getChatHistory(conversationId);
            setMessages(msgs);
        } catch (error) {
            logger.error('Error loading messages:', error);
        } finally {
            setMessagesLoading(false);
        }
    };

    const connectWebSocket = () => {
        websocketService.connect(
            () => { },
            () => { },
            (error) => logger.error('WebSocket error:', error)
        );

        websocketService.onMessageChunk((data) => {
            const chunk = (data as { chunk: string }).chunk;
            setStreamingMessage(prev => prev + chunk);
        });

        websocketService.onMessageComplete((data) => {
            const fullResponse = (data as { fullResponse: string }).fullResponse;
            const newMessage: ChatMessageType = {
                role: 'assistant',
                content: fullResponse,
                createdAt: new Date().toISOString()
            };
            setMessages(prev => [...prev, newMessage]);
            setStreamingMessage('');
            setIsTyping(false);
            scrollToBottom();

            if (activeConversationId) {
                setTimeout(() => loadConversations(), 2500);
            }
        });

        websocketService.onTyping((data) => {
            setIsTyping((data as { isTyping: boolean }).isTyping);
        });

        websocketService.onError((error) => {
            logger.error('WebSocket message error:', error);
            setIsTyping(false);
        });
    };

    const disconnectWebSocket = () => {
        websocketService.disconnect();
    };

    const handleStop = () => {
        streamingService.cancel();
        if (streamingMessage) {
            setMessages(prev => [...prev, {
                role: 'assistant',
                content: streamingMessage,
                createdAt: new Date().toISOString()
            }]);
        }
        setStreamingMessage('');
        setIsTyping(false);
        setIsStreaming(false);
    };

    const handleAgentTask = async (taskId: string, conversationId: string | null) => {
        setIsStreaming(false);
        setAgentGroups([]);

        const findGroupByAgent = (groups: AgentGroup[], agentType: string) => {
            for (let i = groups.length - 1; i >= 0; i--) {
                if (groups[i].agentType === agentType) return i;
            }
            return -1;
        };

        try {
            await agentStreamService.streamTask(
                taskId,
                (event: AgentRunEvent) => {
                    const output = event.output || {};
                    const agentType = event.agentType;

                    if (output.event === 'tasks_generated') {
                        const tasks: AgentStep[] = (output.tasks || []).map((t, idx) => ({
                            id: `task_${idx}`,
                            label: t.description || `Task ${idx + 1}`,
                            status: 'pending',
                        }));
                        const agentName = AGENT_NAME_MAP[agentType] || agentType;

                        setAgentGroups(prev => [
                            ...(prev || []),
                            { id: `${agentType}_${Date.now()}`, agentType, agentName, steps: tasks },
                        ]);
                    } else if (output.event === 'task_started') {
                        setAgentGroups(prev => {
                            if (!prev) return prev;
                            const groups = [...prev];
                            const gi = findGroupByAgent(groups, agentType);
                            if (gi === -1) return prev;
                            groups[gi] = {
                                ...groups[gi],
                                steps: groups[gi].steps.map((s, idx) =>
                                    idx === output.taskIndex ? { ...s, status: 'processing' } : s
                                ),
                            };
                            return groups;
                        });
                    } else if (output.event === 'task_completed') {
                        setAgentGroups(prev => {
                            if (!prev) return prev;
                            const groups = [...prev];
                            const gi = findGroupByAgent(groups, agentType);
                            if (gi === -1) return prev;
                            groups[gi] = {
                                ...groups[gi],
                                steps: groups[gi].steps.map((s, idx) =>
                                    idx === output.taskIndex ? { ...s, status: 'completed' } : s
                                ),
                            };
                            return groups;
                        });
                    }
                },
                (event: AgentDoneEvent) => {
                    setAgentGroups(prev =>
                        prev ? prev.map(g => ({
                            ...g,
                            steps: g.steps.map(s => ({ ...s, status: 'completed' as const })),
                        })) : prev
                    );

                    if (event.finalReport) {
                        const aiMessage: ChatMessageType = {
                            role: 'assistant',
                            content: event.finalReport,
                            createdAt: new Date().toISOString(),
                        };
                        setMessages(prev => [...prev, aiMessage]);
                    }

                    setIsTyping(false);

                    if (conversationId) {
                        setTimeout(() => loadConversations(), 2500);
                    }
                },
                (error: Error) => {
                    logger.error('Agent stream error:', error);
                    setAgentGroups(prev =>
                        prev ? prev.map(g => ({
                            ...g,
                            steps: g.steps.map(s => s.status === 'processing' ? { ...s, status: 'failed' as const } : s),
                        })) : prev
                    );
                    setIsTyping(false);
                }
            );
        } catch (error) {
            logger.error('Agent stream failed:', error);
            setIsTyping(false);
        }
    };

    const handleSendMessage = async (messageText: string) => {
        let currentId = activeConversationId;

        if (!currentId) {
            try {
                const title = 'New Conversation';
                const newConv = await conversationService.createConversation(title);
                currentId = newConv.id;
                justCreatedConversationId.current = currentId;
                draftDocsRef.current[currentId] = [...selectedDocs];
                await loadConversations();
                setActiveConversationId(currentId);
            } catch (e) {
                logger.error("Failed to create chat on send", e);
                return;
            }
        }

        const userMessage: ChatMessageType = {
            role: 'user',
            content: messageText,
            createdAt: new Date().toISOString()
        };

        setAgentGroups(null);

        setMessages(prev => [...prev, userMessage]);
        setIsTyping(true);
        setIsStreaming(true);

        userScrolledUp.current = false;

        const docIds = selectedDocs.filter(d => d.active !== false).map(d => d.id);

        try {
            setStreamingMessage('');
            setStreamingThinking(null);
            setThinkingDuration(null);
            thinkingTextRef.current = '';
            thinkingStartRef.current = null;
            thinkingDurationRef.current = null;

            await streamingService.sendMessage(
                messageText,
                currentId,
                (chunk) => {
                    if (thinkingStartRef.current !== null && thinkingDurationRef.current === null) {
                        thinkingDurationRef.current = Date.now() - thinkingStartRef.current;
                        setThinkingDuration(thinkingDurationRef.current);
                    }
                    setStreamingMessage(prev => prev + chunk);
                },
                (fullResponse) => {
                    const aiMessage: ChatMessageType = {
                        role: 'assistant',
                        content: fullResponse,
                        createdAt: new Date().toISOString(),
                        thinking: thinkingTextRef.current || null,
                        thinkingDuration: thinkingDurationRef.current,
                    };
                    setMessages(prev => [...prev, aiMessage]);
                    setStreamingMessage('');
                    setStreamingThinking(null);
                    setThinkingDuration(null);
                    thinkingTextRef.current = '';
                    thinkingStartRef.current = null;
                    thinkingDurationRef.current = null;
                    setIsTyping(false);
                    setIsStreaming(false);
                },
                (error) => {
                    if (error.name !== 'AbortError') {
                        logger.error('Stream error:', error);
                        setStreamingMessage('');
                    }
                    setStreamingThinking(null);
                    setThinkingDuration(null);
                    setIsTyping(false);
                    setIsStreaming(false);
                },
                (taskId) => {
                    handleAgentTask(taskId, currentId);
                },
                (quota, exceeded) => {
                    setQuotaStatus(quota);
                    setQuotaWarning(quota.warning);
                    setQuotaBlocked(!quota.allowed);
                    if (exceeded) {
                        setIsTyping(false);
                        setIsStreaming(false);
                    }
                },
                docIds.length > 0 ? docIds : null,
                (sources) => {
                    logger.info('RAG sources received:', sources);
                },
                () => {
                    loadConversations();
                },
                (thinkingChunk) => {
                    if (thinkingStartRef.current === null) {
                        thinkingStartRef.current = Date.now();
                    }
                    thinkingTextRef.current += thinkingChunk;
                    setStreamingThinking(thinkingTextRef.current);
                },
            );
        } catch (error) {
            logger.error('handleSendMessage error:', error);
            setIsTyping(false);
            setIsStreaming(false);
        }
    };

    const handleCitationClick = async (filename: string, pageStart: string | null, docId: string | null, pageEnd: string | null = null) => {
        try {
            let docInfo: DocumentItem | undefined;

            if (docId) {
                docInfo = selectedDocs.find(d => d.id === docId);
            }
            if (!docInfo && filename) {
                docInfo = selectedDocs.find(d => d.filename === filename);
            }

            if (!docInfo) {
                const allDocs = await documentService.getDocuments();

                if (docId) {
                    docInfo = allDocs.find(d => d.id === docId);
                }
                if (!docInfo && filename) {
                    docInfo = allDocs.find(d => d.filename === filename);
                }
            }

            if (docInfo) {
                setViewingDocument({ doc: docInfo, pageStart, pageEnd });
            } else {
                setViewingDocument({ doc: { filename, id: docId ?? undefined }, pageStart, pageEnd });
            }
        } catch (error) {
            logger.error('Failed to open citation', error);
            setViewingDocument({ doc: { filename, id: docId ?? undefined }, pageStart, pageEnd });
        }
    };

    const handleDocumentsConfirm = (docs: DocumentItem[]) => {
        setSelectedDocs(prev => {
            const prevMap = new Map(prev.map(d => [d.id, d]));
            return docs.map(d => {
                const existing = prevMap.get(d.id);
                return existing ? { ...existing, active: true } : { ...d, active: true };
            });
        });
    };

    const handleDocumentRemove = (docId: string) => {
        setSelectedDocs(prev => prev.filter(d => d.id !== docId));
    };

    const handleDocumentToggle = (docId: string) => {
        setSelectedDocs(prev => prev.map(d => d.id === docId ? { ...d, active: d.active === false } : d));
    };

    return {
        messages,
        messagesLoading,
        isTyping,
        isStreaming,
        streamingMessage,
        streamingThinking,
        thinkingDuration,
        agentGroups,
        quotaStatus,
        quotaWarning,
        quotaBlocked,
        selectedDocs,
        viewingDocument,
        setViewingDocument,
        chatScrollRef,
        messagesEndRef,
        handleChatScroll,
        handleSendMessage,
        handleCitationClick,
        handleStop,
        handleDocumentsConfirm,
        handleDocumentRemove,
        handleDocumentToggle,
    };
}