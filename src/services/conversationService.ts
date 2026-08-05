import apiService from './apiService';
import type { ConversationSummary, ChatMessage } from '../types';

class ConversationService {
    async getAllConversations(): Promise<ConversationSummary[]> {
        try {
            return await apiService.get<ConversationSummary[]>('/conversations');
        } catch (error) {
            console.error('Error fetching conversations:', error);
            throw error;
        }
    }

    async createConversation(title = 'New Chat'): Promise<ConversationSummary> {
        try {
            return await apiService.post<ConversationSummary>('/conversations', { title });
        } catch (error) {
            console.error('Error creating conversation:', error);
            throw error;
        }
    }

    async getConversation(id: string): Promise<ConversationSummary> {
        try {
            return await apiService.get<ConversationSummary>(`/conversations/${id}`);
        } catch (error) {
            console.error('Error fetching conversation:', error);
            throw error;
        }
    }

    async updateConversation(id: string, updates: Partial<ConversationSummary>): Promise<ConversationSummary> {
        try {
            return await apiService.patch<ConversationSummary>(`/conversations/${id}`, updates);
        } catch (error) {
            console.error('Error updating conversation:', error);
            throw error;
        }
    }

    async deleteConversation(id: string): Promise<void> {
        try {
            await apiService.delete(`/conversations/${id}`);
        } catch (error) {
            console.error('Error deleting conversation:', error);
            throw error;
        }
    }

    async getChatHistory(conversationId: string): Promise<ChatMessage[]> {
        try {
            return await apiService.get<ChatMessage[]>(`/messages/${conversationId}`);
        } catch (error) {
            console.error('Error fetching chat history:', error);
            throw error;
        }
    }

    async exportConversation(conversationId: string, format = 'json'): Promise<void> {
        try {
            const filename = `conversation-${conversationId}.${format}`;
            await apiService.download(`/export/${conversationId}?format=${format}`, filename);
        } catch (error) {
            console.error('Error exporting conversation:', error);
            throw error;
        }
    }
}

export default new ConversationService();
