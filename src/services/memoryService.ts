import apiService from './apiService';
import type { Memory } from '../types';

interface MemorySettings {
    enabled: boolean;
    [key: string]: unknown;
}

class MemoryService {
    async getMemories(): Promise<Memory[]> {
        return apiService.get<Memory[]>('/memory');
    }

    async updateMemory(memoryId: string, content: string): Promise<Memory> {
        return apiService.patch<Memory>(`/memory/${memoryId}`, { content });
    }

    async deleteMemory(memoryId: string): Promise<void> {
        return apiService.delete(`/memory/${memoryId}`);
    }

    async getMemorySettings(): Promise<MemorySettings> {
        return apiService.get<MemorySettings>('/memory/settings');
    }

    async updateMemorySettings(settings: Partial<MemorySettings>): Promise<MemorySettings> {
        return apiService.put<MemorySettings>('/memory/settings', settings);
    }
}

export default new MemoryService();
