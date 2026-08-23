import { useOutletContext } from 'react-router-dom';
import ChatMessage from '../components/chat/ChatMessage';
import ChatInput from '../components/chat/ChatInput';
import TypingIndicator from '../components/chat/TypingIndicator';
import AgentTaskList from '../components/chat/AgentTaskList';
import DocumentSideViewer from '../components/document/DocumentSideViewer';
import DocumentListPanel from '../components/document/DocumentListPanel';
import Topbar from '../components/Topbar';
import useChatMessaging from '../hooks/useChatMessaging';
import useViewer from '../hooks/useViewer';
import type { ChatLayoutContext } from '../layouts/ChatLayout';

export default function ChatPage() {
    const { activeConversationId, setActiveConversationId, settings, loadConversations, conversations } = useOutletContext<ChatLayoutContext>();

    const {
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
    } = useChatMessaging({ activeConversationId, setActiveConversationId, settings, loadConversations });

    const { viewerWidth, splitPaneRef, viewerRef, startResizing } = useViewer({ viewingDocument });

    return (
        <div className="flex flex-col h-full w-full pt-2 pr-2 pb-2 relative">
            <Topbar
                title={conversations?.find(c => c.id === activeConversationId)?.title || 'Chat'}
                isNew={!activeConversationId}
            />
            <div className="flex flex-col flex-1 bg-white rounded-b-2xl border border-gray-200 border-t-0 overflow-hidden relative">
                <div className="flex-1 flex w-full relative overflow-hidden" ref={splitPaneRef}>

                <div className="flex flex-col h-full relative flex-1 min-w-0">
                    <DocumentListPanel
                        selectedDocs={selectedDocs}
                        onToggle={handleDocumentToggle}
                        onRemove={handleDocumentRemove}
                    />
                    <div
                        ref={chatScrollRef}
                        onScroll={handleChatScroll}
                        className="flex-1 overflow-y-auto custom-scrollbar px-6 py-6"
                    >
                        {messagesLoading ? (
                            <div className="h-full flex items-center justify-center">
                                <div className="inline-block h-8 w-8 border-2 border-primary border-t-transparent rounded-full animate-spin" role="status"></div>
                            </div>
                        ) : messages.length === 0 && !isTyping && !agentGroups ? (
                            <div className="h-full flex flex-col items-center justify-center text-center px-4">
                                <div className="w-12 h-12 rounded-full bg-primary flex items-center justify-center text-white font-bold text-lg mb-3">
                                    AI
                                </div>
                                <h3 className="text-lg font-semibold text-text-primary mb-1">How can I help you today?</h3>
                                <p className="text-sm text-text-secondary max-w-md">
                                    Start a conversation by typing a message below.
                                </p>
                            </div>
                        ) : (
                            <div className="max-w-3xl mx-auto pb-4">
                                {messages.map((msg, index) => (
                                    <ChatMessage
                                        key={index}
                                        message={msg}
                                        showTimestamp={settings.show_timestamps}
                                        onDocumentClick={handleCitationClick}
                                    />
                                ))}
                                {agentGroups && agentGroups.length > 0 && (
                                    <div className="mb-6">
                                        {agentGroups.map((group) => (
                                            <AgentTaskList
                                                key={group.id}
                                                steps={group.steps}
                                                agentName={group.agentName}
                                            />
                                        ))}
                                    </div>
                                )}
                                {isTyping && !streamingMessage && !streamingThinking && <TypingIndicator />}
                                {(streamingMessage || streamingThinking !== null) && (
                                    <ChatMessage
                                        message={{
                                            role: 'assistant',
                                            content: streamingMessage,
                                            createdAt: new Date().toISOString(),
                                            thinking: streamingThinking,
                                            thinkingDuration: thinkingDuration,
                                        }}
                                        showTimestamp={false}
                                    />
                                )}
                                <div ref={messagesEndRef} />
                            </div>
                        )}
                    </div>

                    <ChatInput
                        conversationId={activeConversationId}
                        onSend={handleSendMessage}
                        disabled={(isTyping && !isStreaming) || quotaBlocked}
                        quotaBlocked={quotaBlocked}
                        quota={quotaStatus}
                        quotaWarning={quotaWarning}
                        selectedDocs={selectedDocs}
                        onDocumentsConfirm={handleDocumentsConfirm}
                        onDocumentRemove={handleDocumentRemove}
                        isStreaming={isStreaming}
                        onStop={handleStop}
                    />
                </div>

                {viewingDocument && (
                    <div
                        className="w-1 cursor-col-resize z-50 flex-shrink-0 flex items-center justify-center group select-none relative"
                        onMouseDown={startResizing}
                    >
                        <div className="absolute inset-y-0 w-px transition-colors" />
                        <div className="relative z-10 flex flex-col gap-[3px] items-center justify-center w-[6px] h-14 rounded-full bg-page shadow-sm  group-hover:bg-gray-400 group-active:bg-gray-500 transition-all duration-150">
                        </div>
                    </div>
                )}

                {viewingDocument && (
                    <div
                        ref={viewerRef}
                        className="h-full bg-page flex-shrink-0 flex flex-col overflow-hidden"
                        style={{ width: `${viewerWidth}px` }}
                    >
                        <DocumentSideViewer
                            key={`${viewingDocument.doc?.id ?? viewingDocument.doc?.filename}-${viewingDocument.pageStart ?? 'top'}`}
                            document={viewingDocument.doc}
                            pageStart={viewingDocument.pageStart}
                            pageEnd={viewingDocument.pageEnd}
                            onClose={() => setViewingDocument(null)}
                        />
                    </div>
                )}
            </div>
            </div>
        </div>
    );
}