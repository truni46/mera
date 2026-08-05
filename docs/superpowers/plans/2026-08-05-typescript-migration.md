# TypeScript Migration (Frontend) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert the entire Mera frontend (`src/`, React + Vite) from JavaScript (`.jsx`/`.js`) to TypeScript (`.tsx`/`.ts`) with `strict: true`, in one migration pass.

**Architecture:** No runtime/behavior changes — this is a syntax and tooling migration. Each task renames a group of files, adds explicit types (component `Props` interfaces, function signatures, `useState`/`useRef` generics where inference is insufficient), and fixes the resulting `tsc` errors. Files convert bottom-up by dependency direction (utils → services/types → context → hooks → ui components → feature components → layouts → pages → entry point) so that by the time a file is converted, everything it imports is already typed.

**Tech Stack:** TypeScript, Vite (`@vitejs/plugin-react`, `vite-plugin-checker`), React 18, react-router-dom v7.

## Global Constraints

- `tsconfig.json`: `strict: true` from the start (no `noImplicitAny` transition period) — per approved spec.
- API response/request types are hand-written in `src/types/`, not generated from FastAPI's OpenAPI schema — per approved spec.
- Backend (Python/FastAPI) is out of scope for this migration.
- Do not introduce ESLint — none exists in this repo today, and adding one is a separate decision.
- Do not introduce PropTypes — none exist today; TS interfaces replace that role going forward.
- Project naming convention (per `CLAUDE.md`): React component files use PascalCase, already the case for every file in `src/components`, `src/pages`, `src/layouts`, `src/context` — keep as-is, just change the extension (`.jsx` → `.tsx`).
- **Catch-block pattern (applies in every task with a `try/catch`):** `strict: true` types a caught exception as `unknown`, not `any`. Where code reads `error.message` (most `catch` blocks in this codebase do, e.g. `LoginPage.jsx:36`), narrow it first:
  ```ts
  } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // use `message`
  }
  ```
  Where the catch block only does `console.error('...', error)` or `logger.error('...', error)`, no narrowing is needed — those accept `unknown` as-is.
- **Verification command used throughout:** `npm run typecheck` (added in Task 1) must report zero errors for the files touched in that task before moving to the next task. `npm run dev` must still serve the app with no new console errors (spot-check in browser).

---

### Task 1: Tooling & Config Setup

**Files:**
- Modify: `package.json`
- Create: `tsconfig.json`
- Create: `tsconfig.node.json`
- Modify: `vite.config.js` → rename to `vite.config.ts`
- Modify: `index.html`

**Interfaces:**
- Produces: `npm run typecheck` script; `tsconfig.json` with `strict: true`, `jsx: "react-jsx"`, `moduleResolution: "bundler"`, `target: "ES2020"`, `include: ["src"]`; `vite-plugin-checker` wired into the dev server.

- [ ] **Step 1: Install new devDependencies**

```bash
npm install -D typescript @types/node vite-plugin-checker
```

(`@types/react` and `@types/react-dom` are already installed — leave them.)

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true
  },
  "include": ["src"],
  "references": [{ "path": "./tsconfig.node.json" }]
}
```

- [ ] **Step 3: Create `tsconfig.node.json`** (covers `vite.config.ts`, which runs under Node, not the browser)

```json
{
  "compilerOptions": {
    "composite": true,
    "skipLibCheck": true,
    "module": "ESNext",
    "moduleResolution": "bundler",
    "allowSyntheticDefaultImports": true,
    "strict": true
  },
  "include": ["vite.config.ts"]
}
```

- [ ] **Step 4: Rename `vite.config.js` to `vite.config.ts` and add the checker plugin**

Delete `vite.config.js`, create `vite.config.ts`:

```ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import checker from 'vite-plugin-checker'

export default defineConfig({
    plugins: [
        react(),
        checker({ typescript: true }),
    ],
    build: {
        sourcemap: false,
        minify: 'esbuild',
        rollupOptions: {
            output: {
                entryFileNames: 'assets/[name]-[hash].js',
                chunkFileNames: 'assets/[name]-[hash].js',
                assetFileNames: 'assets/[name]-[hash][extname]',
            },
        },
    },
    server: {
        port: 5173,
        proxy: {
            '/api/v1': {
                target: 'http://localhost:3000',
                changeOrigin: true
            }
        }
    }
})
```

- [ ] **Step 5: Update `index.html` entry script path**

In `index.html`, change:
```html
<script type="module" src="/src/main.jsx"></script>
```
to:
```html
<script type="module" src="/src/main.tsx"></script>
```

(`src/main.jsx` itself is renamed to `src/main.tsx` in Task 12 — until then this reference is intentionally broken; that's fine since Task 1 only needs to prove the config loads, not that the app runs yet.)

- [ ] **Step 6: Add `typecheck` script to `package.json`**

In the `"scripts"` block, add:
```json
"typecheck": "tsc --noEmit"
```

- [ ] **Step 7: Verify config loads**

Run: `npx tsc --noEmit -p tsconfig.node.json`
Expected: no errors (only `vite.config.ts` is checked by this config, and it's valid TS already).

Run: `npm run typecheck`
Expected: errors — every existing `.jsx`/`.js` file that imports a `.jsx` file with no extension will fail to resolve, because none of `src/` is TS yet. This is expected at this stage; each subsequent task shrinks this error count. Confirm the command *runs* (not "command not found" / config-parse failure), not that it passes.

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json tsconfig.json tsconfig.node.json vite.config.ts index.html
git rm vite.config.js
git commit -m "chore: add TypeScript tooling (tsconfig, vite-plugin-checker)"
```

---

### Task 2: `utils/` and `hooks/`

**Files:**
- Modify: `src/utils/logger.js` → `src/utils/logger.ts`
- Modify: `src/hooks/useDelayedSpinner.js` → `src/hooks/useDelayedSpinner.ts`

**Interfaces:**
- Produces: `logger` default export with methods `info(message: unknown, ...args: unknown[]): void`, `warn`, `error`, `debug`, `chat` (same signatures). `useDelayedSpinner(isLoading: boolean, delay?: number): boolean`.

- [ ] **Step 1: Convert `src/utils/logger.js` → `src/utils/logger.ts`**

```bash
git mv src/utils/logger.js src/utils/logger.ts
```

Content (only change: parameter types added, `class Logger` fields typed):

```ts
class Logger {
    private isDevelopment: boolean;

    constructor() {
        this.isDevelopment = import.meta.env.DEV;
    }

    private formatMessage(level: string, message: unknown, ...args: unknown[]): unknown[] {
        const timestamp = new Date().toISOString();
        return [`[${timestamp}] [${level}]`, message, ...args];
    }

    info(message: unknown, ...args: unknown[]): void {
        if (this.isDevelopment) {
            console.log(...this.formatMessage('INFO', message), ...args);
        }
    }

    warn(message: unknown, ...args: unknown[]): void {
        console.warn(...this.formatMessage('WARN', message), ...args);
    }

    error(message: unknown, ...args: unknown[]): void {
        console.error(...this.formatMessage('ERROR', message), ...args);
    }

    debug(message: unknown, ...args: unknown[]): void {
        if (this.isDevelopment) {
            console.debug(...this.formatMessage('DEBUG', message), ...args);
        }
    }

    chat(message: unknown, ...args: unknown[]): void {
        if (this.isDevelopment) {
            console.log(...this.formatMessage('CHAT', message), ...args);
        }
    }
}

export default new Logger();
```

- [ ] **Step 2: Convert `src/hooks/useDelayedSpinner.js` → `src/hooks/useDelayedSpinner.ts`**

```bash
git mv src/hooks/useDelayedSpinner.js src/hooks/useDelayedSpinner.ts
```

Content (JSDoc types become real types):

```ts
import { useState, useEffect } from 'react';

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
```

- [ ] **Step 3: Typecheck just these two files**

Run: `npm run typecheck 2>&1 | grep -E "logger\.ts|useDelayedSpinner\.ts"`
Expected: no output (no errors referencing either file). Errors from other still-`.jsx` files are expected and ignored at this stage.

- [ ] **Step 4: Commit**

```bash
git add src/utils/logger.ts src/hooks/useDelayedSpinner.ts
git commit -m "refactor: convert utils/logger and hooks/useDelayedSpinner to TypeScript"
```

---

### Task 3: `src/types/` + `services/`

This is the most consequential task — it defines the shared domain interfaces every later task imports.

**Files:**
- Create: `src/types/user.ts`
- Create: `src/types/conversation.ts`
- Create: `src/types/message.ts`
- Create: `src/types/document.ts`
- Create: `src/types/quota.ts`
- Create: `src/types/memory.ts`
- Create: `src/types/index.ts` (barrel re-export)
- Modify: `src/services/apiService.js` → `.ts`
- Modify: `src/services/conversationService.js` → `.ts`
- Modify: `src/services/documentService.js` → `.ts`
- Modify: `src/services/memoryService.js` → `.ts`
- Modify: `src/services/agentStreamService.js` → `.ts`
- Modify: `src/services/streamingService.js` → `.ts`
- Modify: `src/services/websocketService.js` → `.ts`

**Interfaces:**
- Consumes: nothing (this is a foundation task).
- Produces (exact names/signatures every later task relies on):
  - `User { id: string; email: string; username?: string; fullName?: string; role?: string; preferences?: Record<string, unknown>; createdAt?: string; updatedAt?: string }`
  - `ConversationSummary { id: string; title: string; projectId?: string | null; userId?: string; createdAt: string; updatedAt?: string; metadata?: Record<string, unknown> }`
  - `ChatMessage { role: 'user' | 'assistant' | 'system'; content: string; createdAt?: string; timestamp?: string; model?: string; parentId?: string; metadata?: Record<string, unknown>; thinking?: string | null; thinkingDuration?: number | null }`
  - `DocumentItem { id: string; filename: string; fileType?: string; fileSize?: number; embeddingStatus?: string; scope?: string; ownerId?: string; storedFilename?: string; chunkCount?: number; pageCount?: number; summary?: string; description?: string; tags?: string[]; ocrStatus?: string | null; isScanned?: boolean; createdAt: string; updatedAt?: string }` — named `DocumentItem`, **not** `Document` (that name collides with the DOM lib's global `Document` type and produces confusing errors wherever `document` — the global `window.document` — is also in scope, which is most component files).
  - `QuotaStatus { allowed: boolean; warning: boolean; used?: number; limit?: number; [key: string]: unknown }`
  - `Memory { id: string; content: string; createdAt?: string; lastAccessedAt?: string }`
  - `apiService.get<T = unknown>(endpoint: string): Promise<T>`, `.post<T = unknown>(endpoint: string, data?: unknown): Promise<T>`, `.put`, `.patch`, `.delete` (same shape), `.download(endpoint: string, filename: string): Promise<void>`, `.request<T = unknown>(endpoint: string, options?: RequestOptions): Promise<T>`.
  - `conversationService.getAllConversations(): Promise<ConversationSummary[]>`, `.createConversation(title?: string): Promise<ConversationSummary>`, `.getConversation(id: string): Promise<ConversationSummary>`, `.updateConversation(id: string, updates: Partial<ConversationSummary>): Promise<ConversationSummary>`, `.deleteConversation(id: string): Promise<void>`, `.getChatHistory(conversationId: string): Promise<ChatMessage[]>`, `.exportConversation(conversationId: string, format?: string): Promise<void>`.

- [ ] **Step 1: Create the domain type files**

`src/types/user.ts`:
```ts
export interface User {
    id: string;
    email: string;
    username?: string;
    fullName?: string;
    role?: string;
    preferences?: Record<string, unknown>;
    createdAt?: string;
    updatedAt?: string;
}
```

`src/types/conversation.ts`:
```ts
export interface ConversationSummary {
    id: string;
    title: string;
    projectId?: string | null;
    userId?: string;
    createdAt: string;
    updatedAt?: string;
    metadata?: Record<string, unknown>;
}
```

`src/types/message.ts`:
```ts
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
```

`src/types/document.ts`:
```ts
// Named DocumentItem (not `Document`) to avoid colliding with the DOM lib's
// global `Document` type — most component files also reference the global
// `document` object, and a local `Document` interface shadows/conflicts with it.
export interface DocumentItem {
    id: string;
    filename: string;
    fileType?: string;
    fileSize?: number;
    embeddingStatus?: string;
    scope?: string;
    ownerId?: string;
    storedFilename?: string;
    chunkCount?: number;
    pageCount?: number;
    summary?: string;
    description?: string;
    tags?: string[];
    ocrStatus?: string | null;
    isScanned?: boolean;
    createdAt: string;
    updatedAt?: string;
}
```

`src/types/quota.ts`:
```ts
export interface QuotaStatus {
    allowed: boolean;
    warning: boolean;
    used?: number;
    limit?: number;
    [key: string]: unknown;
}
```

`src/types/memory.ts`:
```ts
export interface Memory {
    id: string;
    content: string;
    createdAt?: string;
    lastAccessedAt?: string;
}
```

`src/types/index.ts`:
```ts
export * from './user';
export * from './conversation';
export * from './message';
export * from './document';
export * from './quota';
export * from './memory';
```

- [ ] **Step 2: Convert `src/services/apiService.js` → `.ts`**

```bash
git mv src/services/apiService.js src/services/apiService.ts
```

```ts
const API_BASE_URL: string = import.meta.env.VITE_API_URL || 'http://localhost:3000/api/v1';

interface RequestOptions extends RequestInit {
    headers?: Record<string, string>;
}

interface ApiErrorBody {
    detail?: string;
    error?: string;
    message?: string;
}

class APIService {
    private baseURL: string;

    constructor(baseURL: string = API_BASE_URL) {
        this.baseURL = baseURL;
    }

    async request<T = unknown>(endpoint: string, options: RequestOptions = {}): Promise<T> {
        const url = `${this.baseURL}${endpoint}`;

        const config: RequestOptions = {
            headers: {
                'Content-Type': 'application/json',
                ...options.headers,
            },
            ...options
        };

        const token = localStorage.getItem('accessToken');
        if (token && config.headers) {
            config.headers['Authorization'] = `Bearer ${token}`;
        }

        try {
            const response = await fetch(url, config);

            if (!response.ok) {
                if (response.status === 401) {
                    localStorage.removeItem('accessToken');
                    window.dispatchEvent(new Event('auth:unauthorized'));
                }

                const error: ApiErrorBody = await response.json().catch(() => ({ detail: 'Request failed' }));
                throw new Error(error.detail || error.error || error.message || `HTTP ${response.status}`);
            }

            const contentType = response.headers.get('content-type');
            if (contentType && contentType.includes('application/json')) {
                return await response.json() as T;
            }

            return await response.text() as unknown as T;
        } catch (error) {
            console.error(`API Error [${endpoint}]:`, error);
            throw error;
        }
    }

    async get<T = unknown>(endpoint: string): Promise<T> {
        return this.request<T>(endpoint, { method: 'GET' });
    }

    async post<T = unknown>(endpoint: string, data?: unknown): Promise<T> {
        return this.request<T>(endpoint, {
            method: 'POST',
            body: JSON.stringify(data),
        });
    }

    async put<T = unknown>(endpoint: string, data?: unknown): Promise<T> {
        return this.request<T>(endpoint, {
            method: 'PUT',
            body: JSON.stringify(data),
        });
    }

    async patch<T = unknown>(endpoint: string, data?: unknown): Promise<T> {
        return this.request<T>(endpoint, {
            method: 'PATCH',
            body: JSON.stringify(data),
        });
    }

    async delete<T = unknown>(endpoint: string): Promise<T> {
        return this.request<T>(endpoint, { method: 'DELETE' });
    }

    async download(endpoint: string, filename: string): Promise<void> {
        try {
            const token = localStorage.getItem('accessToken');
            const config: RequestOptions = { headers: {} };
            if (token && config.headers) {
                config.headers['Authorization'] = `Bearer ${token}`;
            }

            const response = await fetch(`${this.baseURL}${endpoint}`, config);

            if (!response.ok) {
                if (response.status === 401) {
                    localStorage.removeItem('accessToken');
                    window.dispatchEvent(new Event('auth:unauthorized'));
                }
                throw new Error(`HTTP ${response.status}`);
            }

            const blob = await response.blob();

            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            window.URL.revokeObjectURL(url);
        } catch (error) {
            console.error('Download error:', error);
            throw error;
        }
    }
}

export default new APIService();
```

- [ ] **Step 3: Convert `src/services/conversationService.js` → `.ts`**

```bash
git mv src/services/conversationService.js src/services/conversationService.ts
```

```ts
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
```

- [ ] **Step 4: Convert `src/services/documentService.js` → `.ts`**

```bash
git mv src/services/documentService.js src/services/documentService.ts
```

```ts
import apiService from './apiService';
import type { DocumentItem } from '../types';

type ProgressCallback = (percent: number) => void;
type XhrCallback = (xhr: XMLHttpRequest) => void;

interface ApiError extends Error {
    status?: number;
}

class DocumentService {
    uploadDocuments(
        files: File[],
        onProgress?: ProgressCallback,
        scope = 'personal',
        onXhr?: XhrCallback
    ): Promise<DocumentItem[]> {
        return new Promise((resolve, reject) => {
            const formData = new FormData();
            files.forEach(file => formData.append('files', file));

            const xhr = new XMLHttpRequest();
            const token = localStorage.getItem('accessToken');

            if (onXhr) onXhr(xhr);

            xhr.upload.onprogress = (event) => {
                if (event.lengthComputable && onProgress) {
                    onProgress(Math.round((event.loaded / event.total) * 100));
                }
            };

            xhr.onload = () => {
                if (xhr.status >= 200 && xhr.status < 300) {
                    try {
                        resolve(JSON.parse(xhr.responseText));
                    } catch {
                        resolve([]);
                    }
                } else {
                    reject(new Error(xhr.responseText || 'Upload failed'));
                }
            };

            xhr.onerror = () => reject(new Error('Network error during upload'));
            xhr.onabort = () => reject(new Error('Upload aborted'));

            const baseUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000/api/v1';
            xhr.open('POST', `${baseUrl}/knowledge/documents/upload?scope=${scope}`);
            if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
            xhr.send(formData);
        });
    }

    async getDocuments(scope: string | null = null): Promise<DocumentItem[]> {
        const params = scope ? `?scope=${scope}` : '';
        return apiService.get<DocumentItem[]>(`/knowledge/documents${params}`);
    }

    async getDocument(documentId: string): Promise<DocumentItem> {
        return apiService.get<DocumentItem>(`/knowledge/documents/${documentId}`);
    }

    async getDocumentFileUrl(documentId: string): Promise<string> {
        const token = localStorage.getItem('accessToken');
        const baseUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000/api/v1';
        const response = await fetch(
            `${baseUrl}/knowledge/documents/${documentId}/file`,
            { headers: token ? { Authorization: `Bearer ${token}` } : {} }
        );
        if (response.status === 404) {
            const err: ApiError = new Error('Document not found');
            err.status = 404;
            throw err;
        }
        if (!response.ok) throw new Error('Failed to fetch file');
        const blob = await response.blob();
        return URL.createObjectURL(blob);
    }

    async getDocumentOcrText(documentId: string): Promise<unknown> {
        return apiService.get(`/knowledge/documents/${documentId}/ocr`);
    }

    async deleteDocument(documentId: string): Promise<void> {
        return apiService.delete(`/knowledge/documents/${documentId}`);
    }
}

export default new DocumentService();
```

- [ ] **Step 5: Convert `src/services/memoryService.js` → `.ts`**

```bash
git mv src/services/memoryService.js src/services/memoryService.ts
```

```ts
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
```

- [ ] **Step 6: Convert `src/services/agentStreamService.js` → `.ts`**

```bash
git mv src/services/agentStreamService.js src/services/agentStreamService.ts
```

```ts
const API_BASE_URL: string = import.meta.env.VITE_API_URL || 'http://localhost:3000/api/v1';

export interface AgentRunEvent {
    type: 'agent_run';
    agentType: string;
    output?: {
        event?: string;
        tasks?: { description?: string }[];
        taskIndex?: number;
        [key: string]: unknown;
    };
}

export interface AgentDoneEvent {
    type: 'done';
    finalReport?: string;
    [key: string]: unknown;
}

type OnAgentRun = (event: AgentRunEvent) => void;
type OnDone = (event: AgentDoneEvent) => void;
type OnError = (error: Error) => void;

class AgentStreamService {
    private abortController: AbortController | null = null;

    async startTask(goal: string, conversationId?: string): Promise<{ id: string; [key: string]: unknown }> {
        const token = localStorage.getItem('accessToken');
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (token) headers['Authorization'] = `Bearer ${token}`;

        const body: { goal: string; conversationId?: string } = { goal };
        if (conversationId) body.conversationId = conversationId;

        const response = await fetch(`${API_BASE_URL}/agents/tasks`, {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
        });

        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            throw new Error(err.detail || `HTTP ${response.status}`);
        }

        return response.json();
    }

    async streamTask(taskId: string, onAgentRun: OnAgentRun, onDone: OnDone, onError: OnError): Promise<void> {
        try {
            this.abortController = new AbortController();
            const token = localStorage.getItem('accessToken');
            const headers: Record<string, string> = {};
            if (token) headers['Authorization'] = `Bearer ${token}`;

            const response = await fetch(`${API_BASE_URL}/agents/tasks/${taskId}/stream`, {
                method: 'GET',
                headers,
                signal: this.abortController.signal,
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

                            if (data.type === 'agent_run') {
                                onAgentRun(data);
                            } else if (data.type === 'done') {
                                onDone(data);
                                return;
                            } else if (data.type === 'error') {
                                onError(new Error(data.message || 'Agent error'));
                                return;
                            }
                        } catch (err) {
                            console.error('Error parsing agent SSE:', err);
                        }
                    }
                }
            }
        } catch (error) {
            if (error instanceof Error && error.name !== 'AbortError') {
                onError(error);
            }
        }
    }

    cancel(): void {
        if (this.abortController) {
            this.abortController.abort();
            this.abortController = null;
        }
    }
}

export default new AgentStreamService();
```

- [ ] **Step 7: Convert `src/services/streamingService.js` → `.ts`**

```bash
git mv src/services/streamingService.js src/services/streamingService.ts
```

```ts
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
```

- [ ] **Step 8: Convert `src/services/websocketService.js` → `.ts`**

```bash
git mv src/services/websocketService.js src/services/websocketService.ts
```

```ts
import { io, Socket } from 'socket.io-client';

const SOCKET_URL: string = import.meta.env.VITE_SOCKET_URL || 'http://localhost:3000';

type VoidCallback = () => void;
type ErrorCallback = (error: Error) => void;
type DataCallback = (data: unknown) => void;

class WebSocketService {
    private socket: Socket | null = null;
    isConnected = false;
    private reconnectAttempts = 0;
    private readonly maxReconnectAttempts = 5;

    connect(onConnect?: VoidCallback, onDisconnect?: VoidCallback, onError?: ErrorCallback): void {
        if (this.socket) {
            return;
        }

        this.socket = io(SOCKET_URL, {
            transports: ['websocket', 'polling'],
            reconnection: true,
            reconnectionAttempts: this.maxReconnectAttempts,
            reconnectionDelay: 1000,
        });

        this.socket.on('connect', () => {
            console.log('WebSocket connected:', this.socket?.id);
            this.isConnected = true;
            this.reconnectAttempts = 0;
            if (onConnect) onConnect();
        });

        this.socket.on('disconnect', () => {
            console.log('WebSocket disconnected');
            this.isConnected = false;
            if (onDisconnect) onDisconnect();
        });

        this.socket.on('connect_error', (error: Error) => {
            console.error('WebSocket connection error:', error);
            this.reconnectAttempts++;
            if (onError) onError(error);
        });

        this.socket.on('connected', (data: unknown) => {
            console.log('Server welcome:', data);
        });
    }

    sendMessage(message: string, conversationId: string): void {
        if (!this.isConnected || !this.socket) {
            throw new Error('WebSocket not connected');
        }
        this.socket.emit('sendMessage', { message, conversationId });
    }

    sendMessageStreaming(message: string, conversationId: string): void {
        if (!this.isConnected || !this.socket) {
            throw new Error('WebSocket not connected');
        }
        this.socket.emit('sendMessageStreaming', { message, conversationId });
    }

    onMessage(callback: DataCallback): void {
        this.socket?.on('receiveMessage', callback);
    }

    onMessageChunk(callback: DataCallback): void {
        this.socket?.on('messageChunk', callback);
    }

    onMessageComplete(callback: DataCallback): void {
        this.socket?.on('messageComplete', callback);
    }

    onTyping(callback: DataCallback): void {
        this.socket?.on('typing', callback);
    }

    onError(callback: DataCallback): void {
        this.socket?.on('error', callback);
    }

    sendTyping(isTyping: boolean): void {
        if (this.isConnected) {
            this.socket?.emit('typing', { isTyping });
        }
    }

    disconnect(): void {
        if (this.socket) {
            this.socket.disconnect();
            this.socket = null;
            this.isConnected = false;
        }
    }

    removeAllListeners(): void {
        this.socket?.removeAllListeners();
    }
}

export default new WebSocketService();
```

- [ ] **Step 9: Typecheck the services + types layer**

Run: `npm run typecheck 2>&1 | grep -E "services/|types/"`
Expected: no output.

- [ ] **Step 10: Commit**

```bash
git add src/types src/services/*.ts
git commit -m "refactor: convert services/ to TypeScript, add src/types domain interfaces"
```

---

### Task 4: `context/`

**Files:**
- Modify: `src/context/AuthContext.jsx` → `.tsx`
- Modify: `src/context/ToastContext.jsx` → `.tsx`

**Interfaces:**
- Consumes: `User` from `src/types`, `apiService` from Task 3.
- Produces: `useAuth(): { user: User | null; isAuthenticated: boolean; isLoading: boolean; login(email: string, password: string): Promise<boolean>; register(email: string, password: string, fullName: string): Promise<boolean>; logout(): void }`. `useToast(): { toasts: Toast[]; showToast(opts): string; success(title, description?): string; info(title, description?): string; error(title, description?): string; dismiss(id: string): void }`.

- [ ] **Step 1: Convert `src/context/AuthContext.jsx` → `.tsx`**

```bash
git mv src/context/AuthContext.jsx src/context/AuthContext.tsx
```

```tsx
import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import apiService from '../services/apiService';
import type { User } from '../types';

interface AuthContextValue {
    user: User | null;
    isAuthenticated: boolean;
    isLoading: boolean;
    login: (email: string, password: string) => Promise<boolean>;
    register: (email: string, password: string, fullName: string) => Promise<boolean>;
    logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
    const [user, setUser] = useState<User | null>(null);
    const [isAuthenticated, setIsAuthenticated] = useState(false);
    const [isLoading, setIsLoading] = useState(true);
    const navigate = useNavigate();

    const logout = useCallback(() => {
        localStorage.removeItem('accessToken');
        setUser(null);
        setIsAuthenticated(false);
        navigate('/login', { replace: true });
    }, [navigate]);

    useEffect(() => {
        const handleUnauthorized = () => logout();
        window.addEventListener('auth:unauthorized', handleUnauthorized);
        return () => window.removeEventListener('auth:unauthorized', handleUnauthorized);
    }, [logout]);

    useEffect(() => {
        const checkAuth = async () => {
            const token = localStorage.getItem('accessToken');
            if (token) {
                try {
                    const userData = await apiService.get<User>('/auth/me');
                    setUser(userData);
                    setIsAuthenticated(true);
                } catch (error) {
                    console.error('Auth check failed:', error);
                    localStorage.removeItem('accessToken');
                    setUser(null);
                    setIsAuthenticated(false);
                }
            }
            setIsLoading(false);
        };

        checkAuth();
    }, []);

    const login = async (email: string, password: string): Promise<boolean> => {
        try {
            const formData = new URLSearchParams();
            formData.append('username', email);
            formData.append('password', password);

            const response = await apiService.request<{ access_token: string; user: User }>('/auth/login', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                },
                body: formData.toString(),
            });

            const { access_token, user: userData } = response;

            localStorage.setItem('accessToken', access_token);

            setUser(userData);
            setIsAuthenticated(true);
            return true;
        } catch (error) {
            console.error('Login error:', error);
            throw error;
        }
    };

    const register = async (email: string, password: string, fullName: string): Promise<boolean> => {
        try {
            await apiService.post('/auth/register', {
                email,
                password,
                full_name: fullName
            });
            return await login(email, password);
        } catch (error) {
            console.error('Register error:', error);
            throw error;
        }
    };

    return (
        <AuthContext.Provider value={{ user, isAuthenticated, isLoading, login, register, logout }}>
            {children}
        </AuthContext.Provider>
    );
};

export const useAuth = (): AuthContextValue => {
    const context = useContext(AuthContext);
    if (!context) {
        throw new Error('useAuth must be used within an AuthProvider');
    }
    return context;
};
```

- [ ] **Step 2: Convert `src/context/ToastContext.jsx` → `.tsx`**

```bash
git mv src/context/ToastContext.jsx src/context/ToastContext.tsx
```

```tsx
import { createContext, useContext, useState, useCallback, useRef, type ReactNode } from 'react';

export type ToastType = 'success' | 'info' | 'error';

export interface Toast {
    id: string;
    type: ToastType;
    title: string;
    description?: string;
    isExiting: boolean;
}

interface ShowToastOptions {
    type?: ToastType;
    title: string;
    description?: string;
    duration?: number;
}

interface ToastContextValue {
    toasts: Toast[];
    showToast: (options: ShowToastOptions) => string;
    success: (title: string, description?: string) => string;
    info: (title: string, description?: string) => string;
    error: (title: string, description?: string) => string;
    dismiss: (id: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);
const MAX_TOASTS = 5;
const DEFAULT_DURATION = 2000;
const EXIT_ANIMATION_MS = 200;

export const ToastProvider = ({ children }: { children: ReactNode }) => {
    const [toasts, setToasts] = useState<Toast[]>([]);
    const timersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

    const dismiss = useCallback((id: string) => {
        setToasts((prev) =>
            prev.map((t) => (t.id === id ? { ...t, isExiting: true } : t))
        );
        setTimeout(() => {
            setToasts((prev) => prev.filter((t) => t.id !== id));
        }, EXIT_ANIMATION_MS);

        if (timersRef.current[id]) {
            clearTimeout(timersRef.current[id]);
            delete timersRef.current[id];
        }
    }, []);

    const showToast = useCallback(({ type = 'info', title, description, duration = DEFAULT_DURATION }: ShowToastOptions): string => {
        const id = Date.now() + '-' + Math.random().toString(36).slice(2, 9);
        const newToast: Toast = { id, type, title, description, isExiting: false };

        setToasts((prev) => {
            const next = [...prev, newToast];
            if (next.length > MAX_TOASTS) {
                const oldest = next[0];
                dismiss(oldest.id);
                return next.slice(1);
            }
            return next;
        });

        timersRef.current[id] = setTimeout(() => {
            dismiss(id);
            delete timersRef.current[id];
        }, duration);

        return id;
    }, [dismiss]);

    const success = useCallback((title: string, description?: string) => {
        return showToast({ type: 'success', title, description });
    }, [showToast]);

    const info = useCallback((title: string, description?: string) => {
        return showToast({ type: 'info', title, description });
    }, [showToast]);

    const error = useCallback((title: string, description?: string) => {
        return showToast({ type: 'error', title, description });
    }, [showToast]);

    return (
        <ToastContext.Provider value={{ toasts, showToast, success, info, error, dismiss }}>
            {children}
        </ToastContext.Provider>
    );
};

export const useToast = (): ToastContextValue => {
    const context = useContext(ToastContext);
    if (!context) {
        throw new Error('useToast must be used within a ToastProvider');
    }
    return context;
};
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck 2>&1 | grep "context/"`
Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add src/context/AuthContext.tsx src/context/ToastContext.tsx
git commit -m "refactor: convert context/ to TypeScript"
```

---

### Task 5: `components/ui/` (6 files)

**Files:**
- Modify: `src/components/ui/Badge.jsx` → `.tsx`
- Modify: `src/components/ui/Checkbox.jsx` → `.tsx`
- Modify: `src/components/ui/ConfirmDialog.jsx` → `.tsx`
- Modify: `src/components/ui/DropdownMenu.jsx` → `.tsx`
- Modify: `src/components/ui/Table.jsx` → `.tsx`
- Modify: `src/components/ui/Toast.jsx` → `.tsx`

**Interfaces:**
- Produces: `Badge({ children: ReactNode; variant?: 'default'|'primary'|'success'|'error'|'warning'; showSpinner?: boolean; className?: string })`, `Checkbox({ checked: boolean; onChange: (e: ChangeEvent<HTMLInputElement>) => void; onClick?: (e: MouseEvent) => void; indeterminate?: boolean; variant?: 'default'|'header' })`, `ConfirmDialog({ open: boolean; title?: string; description?: string; confirmLabel?: string; cancelLabel?: string; onConfirm: () => void; onCancel: () => void; variant?: 'danger'|'primary' })`, `DropdownMenu<T>({ items: T[]; selectedIndex?: number; onSelect?: (item: T, index: number) => void; onHover?: (index: number) => void; visible?: boolean; position?: 'top'|'bottom'; className?: string; maxHeight?: number; renderItem?: (args) => ReactNode })`, `Table({ headers?: ReactNode[]; children: ReactNode; className?: string })` + named exports `TableRow`, `TableCell`, `ToastContainer({ toasts: Toast[]; onDismiss: (id: string) => void })` (default export, consumes `Toast` type from Task 4's `ToastContext.tsx`).

- [ ] **Step 1: Convert `src/components/ui/Badge.jsx` → `.tsx`**

```bash
git mv src/components/ui/Badge.jsx src/components/ui/Badge.tsx
```

```tsx
import type { ReactNode } from 'react';

type BadgeVariant = 'default' | 'primary' | 'success' | 'error' | 'warning';

const VARIANTS: Record<BadgeVariant, string> = {
    default: 'bg-gray-100 text-gray-600',
    primary: 'bg-blue-100 text-blue-600',
    success: 'bg-green-100 text-green-700',
    error: 'bg-red-100 text-red-600',
    warning: 'bg-yellow-100 text-yellow-700'
};

interface BadgeProps {
    children: ReactNode;
    variant?: BadgeVariant;
    showSpinner?: boolean;
    className?: string;
}

export default function Badge({
    children,
    variant = 'default',
    showSpinner = false,
    className = ''
}: BadgeProps) {
    const baseClass = 'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium';
    const variantClass = VARIANTS[variant] || VARIANTS.default;

    return (
        <span className={`${baseClass} ${variantClass} ${className}`}>
            {showSpinner && (
                <span className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin flex-shrink-0" />
            )}
            {children}
        </span>
    );
}
```

- [ ] **Step 2: Convert `src/components/ui/Checkbox.jsx` → `.tsx`**

```bash
git mv src/components/ui/Checkbox.jsx src/components/ui/Checkbox.tsx
```

```tsx
import type { ChangeEvent, MouseEvent } from 'react';

interface CheckboxProps {
    checked: boolean;
    onChange: (e: ChangeEvent<HTMLInputElement>) => void;
    onClick?: (e: MouseEvent<HTMLLabelElement>) => void;
    indeterminate?: boolean;
    variant?: 'default' | 'header';
}

export default function Checkbox({ checked, onChange, onClick, indeterminate = false, variant = 'default' }: CheckboxProps) {
    const isHeader = variant === 'header';

    const boxClass = indeterminate
        ? 'bg-primary/20 border-primary'
        : checked
            ? isHeader
                ? 'bg-white border-primary'
                : 'bg-primary border-primary'
            : 'bg-white border-gray-400 hover:border-gray-600';

    return (
        <label className="relative inline-flex items-center cursor-pointer" onClick={onClick}>
            <input
                type="checkbox"
                checked={checked}
                onChange={onChange}
                className="sr-only"
            />
            <div className={`w-4 h-4 rounded flex items-center justify-center border transition-all duration-150 ${boxClass}`}>
                {indeterminate && (
                    <svg className="w-2.5 h-2.5 text-primary" viewBox="0 0 12 12" fill="none">
                        <path d="M2.5 6h7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                    </svg>
                )}
                {!indeterminate && checked && (
                    <svg className={`w-2.5 h-2.5 ${isHeader ? 'text-primary' : 'text-white'}`} viewBox="0 0 12 12" fill="none">
                        <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                )}
            </div>
        </label>
    );
}
```

- [ ] **Step 3: Convert `src/components/ui/ConfirmDialog.jsx` → `.tsx`**

```bash
git mv src/components/ui/ConfirmDialog.jsx src/components/ui/ConfirmDialog.tsx
```

```tsx
import { useEffect, useRef } from 'react';
import { HiExclamationTriangle } from 'react-icons/hi2';

interface ConfirmDialogProps {
    open: boolean;
    title?: string;
    description?: string;
    confirmLabel?: string;
    cancelLabel?: string;
    onConfirm: () => void;
    onCancel: () => void;
    variant?: 'danger' | 'primary';
}

export default function ConfirmDialog({
    open,
    title = 'Are you sure?',
    description,
    confirmLabel = 'Delete',
    cancelLabel = 'Cancel',
    onConfirm,
    onCancel,
    variant = 'danger',
}: ConfirmDialogProps) {
    const dialogRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (open) {
            dialogRef.current?.focus();
        }
    }, [open]);

    useEffect(() => {
        if (!open) return;
        const handler = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onCancel();
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [open, onCancel]);

    if (!open) return null;

    const confirmClass = variant === 'danger'
        ? 'bg-red-500 hover:bg-red-600 text-white'
        : 'bg-primary hover:bg-primary/90 text-white';

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center">
            <div className="absolute inset-0 bg-black/40" onClick={onCancel} />
            <div
                ref={dialogRef}
                tabIndex={-1}
                className="relative bg-white rounded-2xl shadow-xl p-6 w-full max-w-sm mx-4 animate-toast-in outline-none"
            >
                <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center flex-shrink-0">
                        <HiExclamationTriangle className="w-5 h-5 text-red-500" />
                    </div>
                    <div className="flex-1 min-w-0">
                        <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
                        {description && (
                            <p className="text-sm text-gray-500 mt-1">{description}</p>
                        )}
                    </div>
                </div>
                <div className="flex items-center justify-end gap-2 mt-5">
                    <button
                        onClick={onCancel}
                        className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
                    >
                        {cancelLabel}
                    </button>
                    <button
                        onClick={onConfirm}
                        className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${confirmClass}`}
                    >
                        {confirmLabel}
                    </button>
                </div>
            </div>
        </div>
    );
}
```

- [ ] **Step 4: Convert `src/components/ui/DropdownMenu.jsx` → `.tsx`**

```bash
git mv src/components/ui/DropdownMenu.jsx src/components/ui/DropdownMenu.tsx
```

```tsx
import { useRef, useEffect, type ReactNode } from 'react';

interface DropdownItem {
    id?: string | number;
    label?: string;
    description?: string;
    [key: string]: unknown;
}

interface RenderItemArgs<T extends DropdownItem> {
    item: T;
    index: number;
    isActive: boolean;
    onSelect?: (item: T, index: number) => void;
    onHover?: (index: number) => void;
}

interface DropdownMenuProps<T extends DropdownItem> {
    items?: T[];
    selectedIndex?: number;
    onSelect?: (item: T, index: number) => void;
    onHover?: (index: number) => void;
    visible?: boolean;
    position?: 'top' | 'bottom';
    className?: string;
    maxHeight?: number;
    renderItem?: (args: RenderItemArgs<T>) => ReactNode;
}

export default function DropdownMenu<T extends DropdownItem>({
    items = [],
    selectedIndex = 0,
    onSelect,
    onHover,
    visible = false,
    position = 'top',
    className = '',
    maxHeight = 195,
    renderItem,
}: DropdownMenuProps<T>) {
    const listRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!visible || !listRef.current) return;
        const active = listRef.current.querySelector('[data-active="true"]');
        if (active) {
            active.scrollIntoView({ block: 'nearest' });
        }
    }, [selectedIndex, visible]);

    if (!visible || items.length === 0) return null;

    const posClass = position === 'top' ? 'bottom-full mb-2' : 'top-full mt-2';

    return (
        <div
            className={`absolute ${posClass} left-0 w-48 bg-white border border-border rounded-lg shadow-xl overflow-hidden animate-fade-in z-50 ${className}`}
        >
            <div
                ref={listRef}
                className="p-1.5 overflow-y-auto dropdown-scroll"
                style={{ maxHeight }}
            >
                {items.map((item, index) => {
                    const isActive = index === selectedIndex;

                    if (renderItem) {
                        return renderItem({ item, index, isActive, onSelect, onHover });
                    }

                    return (
                        <button
                            key={item.id ?? index}
                            data-active={isActive}
                            onClick={() => onSelect?.(item, index)}
                            onMouseEnter={() => onHover?.(index)}
                            className={`w-full px-2.5 py-1.5 text-left rounded-md transition-colors ${isActive ? 'bg-teal-900/10' : 'hover:bg-gray-50'
                                }`}
                        >
                            {item.label && (
                                <div className={`text-sm font-medium ${isActive ? 'text-teal-900' : 'text-text-primary'}`}>
                                    {item.label}
                                </div>
                            )}
                            {item.description && (
                                <div className="text-xs text-text-muted leading-tight truncate">
                                    {item.description}
                                </div>
                            )}
                        </button>
                    );
                })}
            </div>
        </div>
    );
}
```

- [ ] **Step 5: Convert `src/components/ui/Table.jsx` → `.tsx`**

```bash
git mv src/components/ui/Table.jsx src/components/ui/Table.tsx
```

```tsx
import type { ReactNode, MouseEvent } from 'react';

interface TableProps {
    headers?: ReactNode[];
    children: ReactNode;
    className?: string;
}

export default function Table({ headers = [], children, className = '' }: TableProps) {
    return (
        <div className={`overflow-x-auto w-full ${className}`}>
            <table className="w-full text-left border-separate border-spacing-0">
                <thead className="text-text-secondary text-sm font-medium tracking-wide">
                    <tr>
                        {headers.map((header, index) => (
                            <th
                                key={index}
                                className={`py-3 whitespace-nowrap bg-primary text-white border-b border-border-color ${index === 0 && (typeof header !== 'string' || header === '') ? 'w-12 px-3' : 'px-6'} ${index === headers.length - 1 ? 'text-right' : ''} ${index === 0 ? 'rounded-tl-xl' : ''} ${index === headers.length - 1 ? 'rounded-tr-xl' : ''}`}
                            >
                                {header}
                            </th>
                        ))}
                    </tr>
                </thead>
                <tbody className="divide-y divide-border-color bg-white">
                    {children}
                </tbody>
            </table>
        </div>
    );
}

interface TableRowProps {
    children: ReactNode;
    className?: string;
    onClick?: (e: MouseEvent<HTMLTableRowElement>) => void;
}

export function TableRow({ children, className = '', onClick }: TableRowProps) {
    return (
        <tr
            className={`hover:bg-gray-50 transition-colors ${onClick ? 'cursor-pointer' : ''} ${className}`}
            onClick={onClick}
        >
            {children}
        </tr>
    );
}

interface TableCellProps {
    children: ReactNode;
    className?: string;
    isLast?: boolean;
}

export function TableCell({ children, className = '', isLast = false }: TableCellProps) {
    return (
        <td className={`px-6 py-4 whitespace-nowrap ${isLast ? 'text-right' : ''} ${className}`}>
            {children}
        </td>
    );
}
```

- [ ] **Step 6: Convert `src/components/ui/Toast.jsx` → `.tsx`**

```bash
git mv src/components/ui/Toast.jsx src/components/ui/Toast.tsx
```

```tsx
import { HiCheckCircle, HiExclamationCircle, HiXCircle } from 'react-icons/hi';
import type { Toast, ToastType } from '../../context/ToastContext';

const TOAST_CONFIG: Record<ToastType, { icon: typeof HiCheckCircle; iconClass: string }> = {
    success: {
        icon: HiCheckCircle,
        iconClass: 'text-green-500',
    },
    info: {
        icon: HiExclamationCircle,
        iconClass: 'text-blue-500',
    },
    error: {
        icon: HiXCircle,
        iconClass: 'text-red-500',
    },
};

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: (id: string) => void }) {
    const config = TOAST_CONFIG[toast.type] || TOAST_CONFIG.info;
    const Icon = config.icon;
    const animationClass = toast.isExiting ? 'animate-toast-out' : 'animate-toast-in';

    return (
        <div
            className={`flex items-start gap-2.5 px-3 py-2 bg-white rounded-2xl shadow-lg border border-gray-200 w-fit max-w-[420px] h-fit cursor-pointer ${animationClass}`}
            role="alert"
            onClick={() => onDismiss(toast.id)}
        >
            <Icon className={`w-5 h-5 flex-shrink-0  ${config.iconClass}`} />
            <div className="flex flex-col">
                <p className="text-sm font-semibold text-gray-900 leading-5">{toast.title}</p>
                {toast.description && (
                    <p className="text-xs text-gray-500 mt-0.5">{toast.description}</p>
                )}
            </div>
        </div>
    );
}

interface ToastContainerProps {
    toasts: Toast[];
    onDismiss: (id: string) => void;
}

export default function ToastContainer({ toasts, onDismiss }: ToastContainerProps) {
    if (!toasts || toasts.length === 0) return null;

    return (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-50 flex flex-col items-center gap-3 pointer-events-none">
            {toasts.map((toast) => (
                <div key={toast.id} className="pointer-events-auto">
                    <ToastItem toast={toast} onDismiss={onDismiss} />
                </div>
            ))}
        </div>
    );
}
```

Note: this file imports the `Toast`/`ToastType` types from `ToastContext.tsx` (Task 4) — export them from there (already done in Task 4, Step 2 above).

- [ ] **Step 7: Typecheck**

Run: `npm run typecheck 2>&1 | grep "components/ui/"`
Expected: no output.

- [ ] **Step 8: Commit**

```bash
git add src/components/ui/*.tsx
git commit -m "refactor: convert components/ui/ to TypeScript"
```

---

### Task 6: `components/chat/` (7 files)

**Files:**
- Modify: `src/components/chat/ChatMessage.jsx` → `.tsx` (worked example below)
- Modify: `src/components/chat/AgentTaskList.jsx` → `.tsx`
- Modify: `src/components/chat/ConversationList.jsx` → `.tsx`
- Modify: `src/components/chat/ModeSelector.jsx` → `.tsx`
- Modify: `src/components/chat/ThinkingBlock.jsx` → `.tsx`
- Modify: `src/components/chat/TypingIndicator.jsx` → `.tsx`
- Modify: `src/components/chat/ChatInput.jsx` → `.tsx`

**Interfaces:**
- Consumes: `ChatMessage` type from `src/types`, `DocumentItem` from `src/types`.
- Produces: `ChatMessage({ message: ChatMessage; showTimestamp?: boolean; onDocumentClick?: (filename: string, pageStart: string|null, docId: string|null, pageEnd?: string|null) => void })` (component name collides with the domain type name — see note in Step 1 on how this file resolves it), `AgentTaskList({ steps: {id:string;label:string;status:string}[]; agentName: string })`, `ConversationList({ conversations?: ConversationSummary[]; activeId?: string|null; onSelect: (id:string)=>void; onDelete: (id:string)=>void; deletingId?: string|null })`, `ModeSelector({ mode: string; onChange: (mode:string)=>void })`, `ThinkingBlock({ content: string; duration?: number|null })`, `TypingIndicator()` (no props), `ChatInput({ conversationId, onSend, disabled?, quotaBlocked?, quota?, quotaWarning?, selectedDocs?, onDocumentsConfirm, onDocumentRemove, isStreaming?, onStop })`.

- [ ] **Step 1: Convert `src/components/chat/ChatMessage.jsx` → `.tsx`** (worked example — full file, unchanged logic, types added)

```bash
git mv src/components/chat/ChatMessage.jsx src/components/chat/ChatMessage.tsx
```

Note the naming collision: the component is `ChatMessage` and the domain type is also named `ChatMessage` (from `src/types/message.ts`). Import the type under an alias to avoid a name clash with the component function:

```tsx
import ReactMarkdown from 'react-markdown';
import ThinkingBlock from './ThinkingBlock';
import type { ChatMessage as ChatMessageType } from '../../types';

interface ChatMessageProps {
    message: ChatMessageType;
    showTimestamp?: boolean;
    onDocumentClick?: (filename: string, pageStart: string | null, docId: string | null, pageEnd?: string | null) => void;
}

export default function ChatMessage({ message, showTimestamp = true, onDocumentClick }: ChatMessageProps) {
    const isUser = message.role === 'user';
    const date = new Date(message.createdAt || message.timestamp || Date.now());
    const day = date.getDate().toString().padStart(2, '0');
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const year = date.getFullYear().toString();
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
    const timestamp = `${day}/${month}/${year} ${hours}:${minutes}`;

    return (
        <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-6 group w-full`}>
            <div className={`flex items-start space-x-3 ${isUser ? 'max-w-[75%]' : 'w-full'}`}>
                <div className="flex flex-col space-y-1 w-full">
                    {!isUser && typeof message.thinking === 'string' && (
                        <ThinkingBlock content={message.thinking} duration={message.thinkingDuration ?? null} />
                    )}
                    <div className={`${isUser ? 'bg-primary text-white' : 'bg-transparent w-full'} rounded-3xl rounded-tr px-4 py-2`}>
                        <div className={`prose prose-sm max-w-none break-words ${isUser ? 'text-white prose-invert' : 'text-text-primary'} [&>p]:!text-[14.5px] [&>p]:!leading-loose [&>ul>li]:!text-[14.5px] [&>ul>li]:!leading-loose [&>ol>li]:!text-[14.5px] [&>ol>li]:!leading-loose [&>ul]:!list-disc [&>ul]:!pl-5`}>
                            {isUser ? (
                                <p className="whitespace-pre-wrap !text-[14.5px] !leading-loose">{message.content}</p>
                            ) : (() => {
                                function extractPages(attrs: string): { start: string | null; end: string | null } {
                                    const page = attrs.match(/\bpage=(['"])(.*?)\1/)?.[2];
                                    const pages = attrs.match(/\bpages=(['"])(.*?)\1/)?.[2];
                                    const pageStart = attrs.match(/\bpageStart=(['"])(.*?)\1/)?.[2];
                                    const pageEnd = attrs.match(/\bpageEnd=(['"])(.*?)\1/)?.[2];

                                    if (pages) {
                                        const m = pages.match(/^(\d+)(?:-(\d+))?$/);
                                        return m ? { start: m[1], end: m[2] || null } : { start: null, end: null };
                                    }
                                    if (pageStart) return { start: pageStart, end: pageEnd || null };
                                    if (page) return { start: page, end: null };
                                    return { start: null, end: null };
                                }

                                function buildChipLabel(file: string, start: string | null, end: string | null): string {
                                    if (!file) return '';
                                    if (start && end) return `${file} p.${start}–${end}`;
                                    if (start) return `${file} p.${start}`;
                                    return file;
                                }

                                let processedContent = message.content?.replace(/<docref\b[^>]*$/i, '');

                                processedContent = processedContent?.replace(/<docref([^>]*?)>(.*?)<\/docref>/gi, (_match: string, attrs: string) => {
                                    const file = attrs.match(/file=(['"])(.*?)\1/)?.[2] || '';
                                    const docId = attrs.match(/docId=(['"])(.*?)\1/)?.[2] || attrs.match(/\bid=(['"])(.*?)\1/)?.[2];
                                    const { start, end } = extractPages(attrs);

                                    const params = new URLSearchParams();
                                    if (start) params.append('pageStart', start);
                                    if (end) params.append('pageEnd', end);
                                    if (docId) params.append('docId', docId);
                                    const queryString = params.toString();

                                    const url = `#doc:${encodeURIComponent(file)}${queryString ? `?${queryString}` : ''}`;
                                    return `[${buildChipLabel(file, start, end)}](${url})`;
                                });
                                processedContent = processedContent?.replace(/<docref([^>]*?)\/>/gi, (_match: string, attrs: string) => {
                                    const file = attrs.match(/file=(['"])(.*?)\1/)?.[2] || '';
                                    const docId = attrs.match(/docId=(['"])(.*?)\1/)?.[2] || attrs.match(/\bid=(['"])(.*?)\1/)?.[2];
                                    const { start, end } = extractPages(attrs);

                                    const params = new URLSearchParams();
                                    if (start) params.append('pageStart', start);
                                    if (end) params.append('pageEnd', end);
                                    if (docId) params.append('docId', docId);
                                    const queryString = params.toString();

                                    const url = `#doc:${encodeURIComponent(file)}${queryString ? `?${queryString}` : ''}`;
                                    return `[${buildChipLabel(file, start, end)}](${url})`;
                                });

                                return (
                                    <ReactMarkdown
                                        components={{
                                            a({ className, children, href, ...props }) {
                                                if (href?.startsWith('#doc:')) {
                                                    const rawDoc = href.replace('#doc:', '');
                                                    const [encodedFilename, queryString] = rawDoc.split('?');
                                                    const filename = decodeURIComponent(encodedFilename);

                                                    let pageStart: string | null = null, pageEnd: string | null = null, docId: string | null = null;
                                                    if (queryString) {
                                                        const params = new URLSearchParams(queryString);
                                                        pageStart = params.get('pageStart');
                                                        pageEnd = params.get('pageEnd');
                                                        docId = params.get('docId');
                                                    }

                                                    const ext = filename.split('.').pop()?.toLowerCase() ?? '';
                                                    const styleMap: Record<string, { btn: string; icon: string }> = {
                                                        pdf: { btn: 'bg-white hover:bg-orange-100 text-orange-800 border-orange-300', icon: 'text-orange-600' },
                                                        docx: { btn: 'bg-white hover:bg-blue-100 text-blue-800 border-blue-300', icon: 'text-blue-600' },
                                                        doc: { btn: 'bg-white hover:bg-blue-100 text-blue-800 border-blue-300', icon: 'text-blue-600' },
                                                        xlsx: { btn: 'bg-white hover:bg-green-100 text-green-800 border-green-300', icon: 'text-green-600' },
                                                        xls: { btn: 'bg-white hover:bg-green-100 text-green-800 border-green-300', icon: 'text-green-600' },
                                                        csv: { btn: 'bg-white hover:bg-green-100 text-green-800 border-green-300', icon: 'text-green-600' },
                                                        tsv: { btn: 'bg-white hover:bg-green-100 text-green-800 border-green-300', icon: 'text-green-600' },
                                                        txt: { btn: 'bg-white hover:bg-gray-100 text-gray-700 border-gray-300', icon: 'text-gray-500' },
                                                        md: { btn: 'bg-white hover:bg-purple-100 text-purple-800 border-purple-300', icon: 'text-purple-600' },
                                                    };
                                                    const style = styleMap[ext] ?? { btn: 'bg-white hover:bg-blue-200 text-blue-800 border-blue-300', icon: 'text-blue-600' };

                                                    return (
                                                        <button
                                                            className={`inline-flex items-center gap-1.5 px-2 py-0.5 mx-1 rounded-md border transition-colors align-middle cursor-pointer text-xs font-medium ${style.btn}`}
                                                            onClick={(e) => { e.preventDefault(); onDocumentClick?.(filename, pageStart, docId, pageEnd); }}
                                                            title={`View document: ${filename}`}
                                                        >
                                                            <svg className={`w-3.5 h-3.5 flex-shrink-0 ${style.icon}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                                            </svg>
                                                            {children}
                                                        </button>
                                                    );
                                                }
                                                return <a href={href} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline" {...props}>{children}</a>;
                                            },
                                            code({ className, children, ...props }) {
                                                const match = /language-(\w+)/.exec(className || '')
                                                return match ? (
                                                    <div className="rounded-md bg-gray-800 p-2 my-2 overflow-x-auto text-xs text-white">
                                                        <code className={className} {...props}>
                                                            {children}
                                                        </code>
                                                    </div>
                                                ) : (
                                                    <code className="bg-gray-100 px-1 py-0.5 rounded text-sm font-mono text-red-500" {...props}>
                                                        {children}
                                                    </code>
                                                )
                                            }
                                        }}
                                    >
                                        {processedContent}
                                    </ReactMarkdown>
                                );
                            })()}
                        </div>
                    </div>

                    {showTimestamp && (
                        <span className="text-xs text-text-muted opacity-0 group-hover:opacity-100 transition-opacity px-4">
                            {timestamp}
                        </span>
                    )}
                </div>
            </div>
        </div>
    );
}
```

(One behavioral note surfaced by strict mode, not a change: the original `code({ node, inline, className, children, ...props })` destructured an `inline` prop that `react-markdown`'s current typings don't define on the `code` renderer — it was already effectively `undefined` at runtime for this react-markdown version. Strict mode's `noImplicitAny` will flag `inline` as an error since it can't infer its type from an unknown prop. Drop it from the destructure and the `!inline &&` check, as shown above — the JSX code blocks already differentiate fenced vs. inline code via the `language-` class match, which is what actually drove the visual branch.)

- [ ] **Step 2: Convert the remaining 6 `components/chat/` files**

For each file below: `git mv <name>.jsx <name>.tsx`, then add a `Props` interface above the component derived from its destructured parameters (already known from the signatures below), typing event handlers as `(arg: Type) => void` and array props with their element type. Run `npm run typecheck` after each, fix errors, before moving to the next file.

- **`AgentTaskList.jsx`** — `export default function AgentTaskList({ steps, agentName })`. `steps` is `{ id: string; label: string; status: 'pending' | 'processing' | 'completed' | 'failed' }[]` (matches the shape built in `ChatPage.jsx`'s `handleAgentTask`). `agentName: string`.
- **`ConversationList.jsx`** — `export default function ConversationList({ conversations = [], activeId, onSelect, onDelete, deletingId })`. `conversations: ConversationSummary[]` (import from `../../types`), `activeId?: string | null`, `onSelect: (id: string) => void`, `onDelete: (id: string) => void`, `deletingId?: string | null`.
- **`ModeSelector.jsx`** — `export default function ModeSelector({ mode, onChange })`. `mode: string`, `onChange: (mode: string) => void`.
- **`ThinkingBlock.jsx`** — `export default function ThinkingBlock({ content, duration })`. `content: string`, `duration?: number | null`.
- **`TypingIndicator.jsx`** — `export default function TypingIndicator()`. No props — no interface needed, just rename the extension.

- [ ] **Step 3: Convert `src/components/chat/ChatInput.jsx` → `.tsx`** (largest file in this group — 380 lines; do this one last within the group)

```bash
git mv src/components/chat/ChatInput.jsx src/components/chat/ChatInput.tsx
```

Add this `Props` interface (derived from the full destructured signature — confirmed via `grep -n "ChatInput({" -A 12 src/components/chat/ChatInput.jsx` before renaming, since the destructure spans multiple lines):

```tsx
import type { DocumentItem, QuotaStatus } from '../../types';

interface ChatInputProps {
    conversationId: string | null;
    onSend: (message: string) => void;
    disabled?: boolean;
    quotaBlocked?: boolean;
    quota?: QuotaStatus | null;
    quotaWarning?: boolean;
    selectedDocs?: DocumentItem[];
    onDocumentsConfirm: (docs: DocumentItem[]) => void;
    onDocumentRemove: (docId: string) => void;
    isStreaming?: boolean;
    onStop: () => void;
}
```

Apply it to the component signature (`export default function ChatInput({ ...destructured props... }: ChatInputProps) {`), keep the rest of the file's logic unchanged, then fix whatever `tsc` flags — expect a handful of implicit-`any` on local helper function parameters (`matchCommand(query)`, `filterCommands(query)`, `getSlashCommand(text)`, `getFileColorConfig(filename)`, `escapeHtml(text)`, `getCaretOffset(el)`, `restoreCaret(el, offset)`); type each based on its usage (all take `string` except `getCaretOffset(el: HTMLElement)` / `restoreCaret(el: HTMLElement, offset: number)`, which operate on a contenteditable DOM node).

- [ ] **Step 4: Typecheck the whole group**

Run: `npm run typecheck 2>&1 | grep "components/chat/"`
Expected: no output.

- [ ] **Step 5: Manual smoke test**

`npm run dev`, open the app, send a chat message, confirm the message renders, a citation link (if any test doc is loaded) still opens the side viewer, and the browser console has no new errors.

- [ ] **Step 6: Commit**

```bash
git add src/components/chat/*.tsx
git commit -m "refactor: convert components/chat/ to TypeScript"
```

---

### Task 7: `components/document/` (8 files)

**Files:**
- Modify: `src/components/document/DocumentCard.jsx` → `.tsx` (worked example below)
- Modify: `src/components/document/DocumentDetailModal.jsx` → `.tsx`
- Modify: `src/components/document/DocumentListPanel.jsx` → `.tsx`
- Modify: `src/components/document/DocumentPickerModal.jsx` → `.tsx`
- Modify: `src/components/document/DocumentSideViewer.jsx` → `.tsx`
- Modify: `src/components/document/DocumentStatusBadge.jsx` → `.tsx`
- Modify: `src/components/document/DocumentTable.jsx` → `.tsx`
- Modify: `src/components/document/DocumentUploadZone.jsx` → `.tsx`
- Modify: `src/components/document/OcrViewerModal.jsx` → `.tsx`

**Interfaces:**
- Consumes: `DocumentItem` from `src/types`, `TableRow`/`TableCell` from Task 5's `Table.tsx`, `Checkbox` from Task 5.
- Produces: `DocumentCard({ document: DocumentItem; selected: boolean; onToggleSelect: () => void; onView: (doc: DocumentItem) => void; onDelete: (id: string) => void; onViewOcr: (doc: DocumentItem) => void })`.

- [ ] **Step 1: Convert `src/components/document/DocumentCard.jsx` → `.tsx`** (worked example — full file)

```bash
git mv src/components/document/DocumentCard.jsx src/components/document/DocumentCard.tsx
```

```tsx
import { useState } from 'react';
import { FiTrash2, FiAlignLeft } from 'react-icons/fi';
import { HiTrash } from 'react-icons/hi2';
import DocumentStatusBadge from './DocumentStatusBadge';
import { TableRow, TableCell } from '../ui/Table';
import Checkbox from '../ui/Checkbox';
import type { DocumentItem } from '../../types';

function formatFileSize(bytes?: number): string {
    if (!bytes) return '—';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface DocumentCardProps {
    document: DocumentItem;
    selected: boolean;
    onToggleSelect: () => void;
    onView: (doc: DocumentItem) => void;
    onDelete: (id: string) => void;
    onViewOcr: (doc: DocumentItem) => void;
}

export default function DocumentCard({ document, selected, onToggleSelect, onView, onDelete, onViewOcr }: DocumentCardProps) {
    const [hovered, setHovered] = useState(false);
    const date = new Date(document.createdAt).toLocaleDateString('en-GB', {
        day: '2-digit', month: 'short', year: 'numeric',
    });

    return (
        <TableRow onClick={() => onView(document)}>
            <TableCell>
                <div className="flex items-center justify-center">
                    <Checkbox
                        checked={!!selected}
                        onChange={e => { e.stopPropagation(); onToggleSelect(); }}
                        onClick={e => e.stopPropagation()}
                    />
                </div>
            </TableCell>
            <TableCell>
                <div className="flex items-center gap-3">
                    <span
                        className="font-medium text-sm truncate max-w-xs"
                        title={document.filename}
                    >
                        {document.filename}
                    </span>
                </div>
            </TableCell>
            <TableCell className="text-sm text-text-secondary uppercase">
                {document.fileType || '—'}
            </TableCell>
            <TableCell className="text-sm text-text-secondary">
                {formatFileSize(document.fileSize)}
            </TableCell>
            <TableCell>
                <DocumentStatusBadge status={document.embeddingStatus} />
            </TableCell>
            <TableCell className="text-sm text-text-secondary">
                {date}
            </TableCell>
            <TableCell isLast>
                <div className="flex items-center justify-end gap-0.5">
                    {document.isScanned && document.ocrStatus === 'completed' && (
                        <button
                            onClick={e => { e.stopPropagation(); onViewOcr(document); }}
                            className="p-2 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded transition-colors"
                            title="View OCR result"
                        >
                            <FiAlignLeft size={15} />
                        </button>
                    )}
                    <button
                        onClick={e => { e.stopPropagation(); onDelete(document.id); }}
                        onMouseEnter={() => setHovered(true)}
                        onMouseLeave={() => setHovered(false)}
                        className="p-2 transition-colors rounded"
                        title="Delete"
                    >
                        {hovered
                            ? <HiTrash size={16} className="text-red-700" />
                            : <FiTrash2 size={16} className="text-gray-400" />
                        }
                    </button>
                </div>
            </TableCell>
        </TableRow>
    );
}
```

Note: the parameter is named `document`, shadowing the global `window.document` inside this component's scope — that's valid TS/JS (same as the original `.jsx`), which is exactly why `DocumentItem` (Task 3) is not named `Document`.

- [ ] **Step 2: Convert the remaining 7 `components/document/` files**

Same procedure as Task 6 Step 2 (rename, add a `Props` interface from the known destructured signature, typecheck, fix, commit-ready) — signatures already confirmed via grep:

- **`DocumentStatusBadge.jsx`** — `export default function DocumentStatusBadge({ status })`. `status?: string`.
- **`DocumentListPanel.jsx`** — `export default function DocumentListPanel({ selectedDocs, onToggle, onRemove })`. `selectedDocs: DocumentItem[]`, `onToggle: (docId: string) => void`, `onRemove: (docId: string) => void`.
- **`DocumentDetailModal.jsx`** — `export default function DocumentDetailModal({ document, onClose })`. `document: DocumentItem`, `onClose: () => void`. Internal helper `formatDate(dateStr: string): string`.
- **`DocumentPickerModal.jsx`** — `export default function DocumentPickerModal({ onConfirm, onClose, selectedIds = [] })`. `onConfirm: (docs: DocumentItem[]) => void`, `onClose: () => void`, `selectedIds?: string[]`. Internal helper `formatDate(dateStr: string): string`.
- **`DocumentSideViewer.jsx`** — `export default function DocumentSideViewer({ document, pageStart, pageEnd, onClose })`. `document: DocumentItem | { filename?: string; id?: string }` (per `ChatPage.jsx`'s `viewingDocument.doc`, this can be a partial placeholder object before the real doc loads — read the full file during conversion to confirm and narrow if the partial-object case turns out unused), `pageStart?: string | number | null`, `pageEnd?: string | number | null`, `onClose: () => void`. Internal helper `parsePageLabel(str: string)`.
- **`DocumentTable.jsx`** — `export default function DocumentTable({ refreshTrigger })`. `refreshTrigger: number`. Internal helper `hasProcessingDocs(docs: DocumentItem[]): boolean`.
- **`OcrViewerModal.jsx`** — `export default function OcrViewerModal({ document, onClose })`. `document: DocumentItem`, `onClose: () => void`. Internal components `ImageViewer({ fileUrl }: { fileUrl: string })`, `OcrTextPanel({ text, loading, error }: { text?: string; loading: boolean; error?: string | null })`.
- **`DocumentUploadZone.jsx`** — `export default function DocumentUploadZone({ onUploadComplete })`. `onUploadComplete: () => void`. Internal component `FileProgressItem({ item, onPause, onResume, onCancel })` — `item` is a local upload-progress tracking object (`{ file: File; progress: number; status: string; xhr?: XMLHttpRequest }` — confirm exact shape by reading the full file, since it's constructed locally in this component rather than coming from `src/types`), `onPause: (item) => void`, `onResume: (item) => void`, `onCancel: (item) => void`.

- [ ] **Step 3: Typecheck the whole group**

Run: `npm run typecheck 2>&1 | grep "components/document/"`
Expected: no output.

- [ ] **Step 4: Manual smoke test**

`npm run dev`, go to `/documents`, confirm the table renders, upload zone still accepts a file, and a document card opens its detail/side viewer without console errors.

- [ ] **Step 5: Commit**

```bash
git add src/components/document/*.tsx
git commit -m "refactor: convert components/document/ to TypeScript"
```

---

### Task 8: `components/viewer/` (6 files)

**Files:**
- Modify: `src/components/viewer/PDFViewer.jsx` → `.tsx` (worked example below)
- Modify: `src/components/viewer/ExcelViewer.jsx` → `.tsx`
- Modify: `src/components/viewer/MarkdownViewer.jsx` → `.tsx`
- Modify: `src/components/viewer/TextViewer.jsx` → `.tsx`
- Modify: `src/components/viewer/TSVViewer.jsx` → `.tsx`
- Modify: `src/components/viewer/WordViewer.jsx` → `.tsx`

**Interfaces:**
- Produces: `PDFViewer({ fileUrl: string; initialPage?: number; scale?: number; onScaleChange?: (scale: number) => void })`. The other viewers share the simpler `{ fileUrl: string }` shape except `WordViewer`, noted below.

- [ ] **Step 1: Convert `src/components/viewer/PDFViewer.jsx` → `.tsx`** (worked example — full file)

```bash
git mv src/components/viewer/PDFViewer.jsx src/components/viewer/PDFViewer.tsx
```

```tsx
import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.min.mjs',
    import.meta.url,
).toString();

const PAGE_BUFFER = 3;
const PAGE_HEIGHT_ESTIMATE = 900;
const DEBOUNCE_MS = 300;

function PagePlaceholder({ width, height, pageNumber }: { width: number; height: number; pageNumber: number }) {
    return (
        <div
            className="flex items-center justify-center bg-white"
            style={{ width: `${width}px`, height: `${height}px` }}
        >
            <div className="flex flex-col items-center gap-2 text-gray-300">
                <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                <span className="text-xs">Page {pageNumber}</span>
            </div>
        </div>
    );
}

interface PDFViewerProps {
    fileUrl: string;
    initialPage?: number;
    scale?: number;
    onScaleChange?: (scale: number) => void;
}

interface RenderRange {
    start: number;
    end: number;
}

export default function PDFViewer({ fileUrl, initialPage = 1, scale = 1.0, onScaleChange }: PDFViewerProps) {
    const [numPages, setNumPages] = useState<number | null>(null);
    const [visiblePage, setVisiblePage] = useState(initialPage);
    const [pageInput, setPageInput] = useState('');
    const [zoomInput, setZoomInput] = useState(Math.round(scale * 100).toString());
    const [renderRange, setRenderRange] = useState<RenderRange>({ start: 1, end: 1 + PAGE_BUFFER * 2 });
    const scrollContainerRef = useRef<HTMLDivElement>(null);
    const observerRef = useRef<IntersectionObserver | null>(null);
    const pageHeightsRef = useRef<Record<number, number>>({});
    const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const pendingPageRef = useRef<number | null>(null);
    const scaleRef = useRef(scale);
    const visiblePageRef = useRef(initialPage);
    const prevScaleRef = useRef(scale);
    const hasScrolledRef = useRef(false);

    const scrollToPage = useCallback((pageNum: number) => {
        const pageElement = document.getElementById(`pdf-page-${pageNum}`);
        if (pageElement) {
            pageElement.scrollIntoView({ behavior: 'auto', block: 'start' });
        }
    }, []);

    useEffect(() => {
        setZoomInput(Math.round(scale * 100).toString());
        scaleRef.current = scale;
    }, [scale]);

    useEffect(() => {
        if (prevScaleRef.current === scale) return;
        prevScaleRef.current = scale;
        const page = visiblePageRef.current;
        requestAnimationFrame(() => {
            requestAnimationFrame(() => scrollToPage(page));
        });
    }, [scale, scrollToPage]);

    const setScale = useCallback((updater: number | ((prev: number) => number)) => {
        if (!onScaleChange) return;
        const next = typeof updater === 'function' ? updater(scale) : updater;
        const clamped = Math.min(3.0, Math.max(0.2, parseFloat(next.toFixed(1))));
        onScaleChange(clamped);
    }, [onScaleChange, scale]);

    useEffect(() => {
        const container = scrollContainerRef.current;
        if (!container) return;
        const handler = (e: WheelEvent) => {
            if (!e.ctrlKey) return;
            e.preventDefault();
            const delta = e.deltaY > 0 ? -0.1 : 0.1;
            setScale(s => parseFloat((s + delta).toFixed(1)));
        };
        container.addEventListener('wheel', handler, { passive: false });
        return () => container.removeEventListener('wheel', handler);
    }, [setScale]);

    const updateRenderRangeDebounced = useCallback((pageNum: number, total: number) => {
        pendingPageRef.current = pageNum;
        if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = setTimeout(() => {
            const p = pendingPageRef.current;
            if (p === null) return;
            const newStart = Math.max(1, p - PAGE_BUFFER);
            const newEnd = Math.min(total, p + PAGE_BUFFER);
            setRenderRange(prev => {
                if (newStart === prev.start && newEnd === prev.end) return prev;
                return { start: newStart, end: newEnd };
            });
            debounceTimerRef.current = null;
        }, DEBOUNCE_MS);
    }, []);

    const onDocumentLoadSuccess = useCallback(({ numPages: total }: { numPages: number }) => {
        setNumPages(total);
        const validPage = (!initialPage || isNaN(initialPage)) ? 1 : initialPage;
        const start = Math.max(1, validPage - PAGE_BUFFER);
        const end = Math.min(total, validPage + PAGE_BUFFER);
        setRenderRange({ start, end });
        if (validPage > 1) {
            setTimeout(() => {
                if (!hasScrolledRef.current) {
                    hasScrolledRef.current = true;
                    scrollToPage(validPage);
                }
            }, 500);
        }
    }, [initialPage, scrollToPage]);

    useEffect(() => {
        setNumPages(null);
        setVisiblePage(initialPage);
        visiblePageRef.current = initialPage;
        pageHeightsRef.current = {};
        hasScrolledRef.current = false;
    }, [fileUrl, initialPage]);

    useEffect(() => {
        return () => {
            if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
        };
    }, []);

    const onPageLoadSuccess = useCallback((page: { pageNumber: number; height: number; width: number }) => {
        pageHeightsRef.current[page.pageNumber] = page.height * (700 * scaleRef.current / page.width);
        if (!isNaN(initialPage) && page.pageNumber === initialPage && !hasScrolledRef.current) {
            hasScrolledRef.current = true;
            scrollToPage(initialPage);
        }
    }, [initialPage, scrollToPage]);

    useEffect(() => {
        setPageInput(visiblePage.toString());
        visiblePageRef.current = visiblePage;
    }, [visiblePage]);

    const handlePageSubmit = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') {
            const p = parseInt(pageInput, 10);
            if (!isNaN(p) && p >= 1 && numPages !== null && p <= numPages) {
                if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
                const start = Math.max(1, p - PAGE_BUFFER);
                const end = Math.min(numPages, p + PAGE_BUFFER);
                setRenderRange({ start, end });
                setTimeout(() => scrollToPage(p), 100);
            } else {
                setPageInput(visiblePage.toString());
            }
        }
    };

    const handleZoomSubmit = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') {
            const z = parseInt(zoomInput, 10);
            if (!isNaN(z) && z >= 20 && z <= 500) {
                onScaleChange?.(z / 100);
            } else {
                setZoomInput(Math.round(scale * 100).toString());
            }
        }
    };

    useEffect(() => {
        if (!numPages) return;

        if (observerRef.current) {
            observerRef.current.disconnect();
        }

        const visibilityObserver = new IntersectionObserver(
            (entries) => {
                let latestPage: number | null = null;
                entries.forEach(entry => {
                    if (entry.isIntersecting) {
                        const pageNum = parseInt(entry.target.id.replace('pdf-page-', ''), 10);
                        if (!isNaN(pageNum)) {
                            latestPage = pageNum;
                        }
                    }
                });
                if (latestPage !== null) {
                    setVisiblePage(latestPage);
                    updateRenderRangeDebounced(latestPage, numPages);
                }
            },
            {
                root: scrollContainerRef.current,
                rootMargin: '-50% 0px -50% 0px',
                threshold: 0,
            },
        );

        observerRef.current = visibilityObserver;

        setTimeout(() => {
            for (let i = 1; i <= numPages; i++) {
                const el = document.getElementById(`pdf-page-${i}`);
                if (el) visibilityObserver.observe(el);
            }
        }, 100);

        return () => {
            if (observerRef.current) observerRef.current.disconnect();
        };
    }, [numPages, updateRenderRangeDebounced]);

    const pageWidth = 700 * scale;

    const shouldRenderPage = useCallback((pageNum: number) => {
        return pageNum >= renderRange.start && pageNum <= renderRange.end;
    }, [renderRange]);

    const getPageHeight = useCallback((pageNum: number) => {
        return pageHeightsRef.current[pageNum] || PAGE_HEIGHT_ESTIMATE * scale;
    }, [scale]);

    const pages = useMemo(() => {
        if (!numPages) return null;
        return Array.from({ length: numPages }, (_, index) => {
            const pageNum = index + 1;
            const render = shouldRenderPage(pageNum);
            return (
                <div
                    key={`page_${pageNum}`}
                    id={`pdf-page-${pageNum}`}
                    className="mb-4 shadow-md bg-white"
                    style={!render ? { width: `${pageWidth}px`, height: `${getPageHeight(pageNum)}px` } : undefined}
                >
                    {render ? (
                        <Page
                            pageNumber={pageNum}
                            width={pageWidth}
                            onLoadSuccess={onPageLoadSuccess}
                            loading={
                                <PagePlaceholder width={pageWidth} height={getPageHeight(pageNum)} pageNumber={pageNum} />
                            }
                        />
                    ) : (
                        <PagePlaceholder width={pageWidth} height={getPageHeight(pageNum)} pageNumber={pageNum} />
                    )}
                </div>
            );
        });
    }, [numPages, pageWidth, shouldRenderPage, getPageHeight, onPageLoadSuccess]);

    return (
        <div className="flex flex-col h-full w-full relative overflow-hidden bg-gray-200">
            <div className="flex-1 overflow-y-auto w-full flex flex-col items-center p-4 custom-scrollbar" ref={scrollContainerRef}>
                <Document
                    file={fileUrl}
                    onLoadSuccess={onDocumentLoadSuccess}
                    loading={
                        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 z-20">
                            <div className="w-8 h-8 border-[3px] border-primary border-t-transparent rounded-full animate-spin" />
                            <p className="text-sm font-medium text-gray-500">Loading PDF...</p>
                        </div>
                    }
                    error={
                        <div className="absolute inset-0 flex items-center justify-center z-20">
                            <div className="bg-red-50 text-red-600 px-4 py-3 rounded-lg text-sm border border-red-200 shadow-sm flex items-center gap-2">
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                                Failed to load PDF
                            </div>
                        </div>
                    }
                >
                    {pages}
                </Document>
            </div>

            {numPages && (
                <div className="absolute bottom-6 left-1/2 -translate-x-1/2 bg-gray-800/80 text-white pl-3 text-sm font-medium shadow-md backdrop-blur-sm z-10 transition-opacity flex items-center border border-gray-700 overflow-hidden" style={{ borderRadius: '20px' }}>
                    <span className="text-gray-300 mr-2 text-xs uppercase tracking-wider">Page</span>
                    <input
                        type="text"
                        value={pageInput}
                        onChange={(e) => setPageInput(e.target.value)}
                        onKeyDown={handlePageSubmit}
                        onBlur={() => setPageInput(visiblePage.toString())}
                        className="w-8 text-center bg-transparent border-none focus:outline-none focus:bg-gray-700/50 py-1.5 transition-colors font-semibold"
                        title="Type page number and press Enter"
                    />
                    <span className="text-gray-400 mx-1">/</span>
                    <span className="pr-4 py-1.5">{numPages}</span>
                </div>
            )}
        </div>
    );
}
```

`handleZoomSubmit` is defined but was already unused-if-not-wired in the original file (confirm during conversion whether it's actually attached to an `onKeyDown` further down — grep showed only `handlePageSubmit` referenced in the visible JSX). If `tsc`/`vite-plugin-checker` doesn't flag it (unused locals aren't part of `strict`, they need `noUnusedLocals` which is not in this migration's tsconfig), leave it as-is — don't remove working code as a side effect of typing it.

- [ ] **Step 2: Convert the 5 simple `{ fileUrl }` viewers**

Same procedure: rename, add `interface Props { fileUrl: string }`, typecheck, fix, ready to commit.

- **`ExcelViewer.jsx`** — `export default function ExcelViewer({ fileUrl })`.
- **`MarkdownViewer.jsx`** — `export default function MarkdownViewer({ fileUrl })`.
- **`TextViewer.jsx`** — `export default function TextViewer({ fileUrl })`.
- **`TSVViewer.jsx`** — `export default function TSVViewer({ fileUrl })`.

- [ ] **Step 3: Convert `src/components/viewer/WordViewer.jsx` → `.tsx`**

```bash
git mv src/components/viewer/WordViewer.jsx src/components/viewer/WordViewer.tsx
```

This file has two components: an inner `WordViewerInner({ fileUrl, initialPage = 1, scale = 1.0, onScaleChange })` (same prop shape as `PDFViewer`) and a default-exported wrapper `WordViewer(props)` that spreads `props` through (likely an error-boundary or lazy-load wrapper — read the full file during conversion to see exactly what it does with `props` before typing it, since the grep signature alone doesn't show the wrapper's body). Type the wrapper's `props` parameter as the same `WordViewerProps` interface used for `WordViewerInner`:

```tsx
interface WordViewerProps {
    fileUrl: string;
    initialPage?: number;
    scale?: number;
    onScaleChange?: (scale: number) => void;
}
```

- [ ] **Step 4: Typecheck the whole group**

Run: `npm run typecheck 2>&1 | grep "components/viewer/"`
Expected: no output.

- [ ] **Step 5: Manual smoke test**

`npm run dev`, open a PDF and a non-PDF document (e.g. an uploaded `.docx` or `.xlsx`) via the document side viewer, confirm both render and page/zoom controls on the PDF viewer still work.

- [ ] **Step 6: Commit**

```bash
git add src/components/viewer/*.tsx
git commit -m "refactor: convert components/viewer/ to TypeScript"
```

---

### Task 9: `components/` root-level (6 files)

**Files:**
- Modify: `src/components/Sidebar.jsx` → `.tsx` (worked example below)
- Modify: `src/components/ConnectionStatus.jsx` → `.tsx`
- Modify: `src/components/QuotaWidget.jsx` → `.tsx`
- Modify: `src/components/SettingsPanel.jsx` → `.tsx`
- Modify: `src/components/Topbar.jsx` → `.tsx`
- Modify: `src/components/UserMenu.jsx` → `.tsx`

**Interfaces:**
- Consumes: `ConversationSummary`, `User` from `src/types`; `ConversationList` from Task 6.
- Produces: `Sidebar({ conversations?: ConversationSummary[]; activeConversationId?: string|null; onNewChat?: () => void; onSelectConversation?: (id:string) => void; onDeleteConversation?: (id:string) => void; user?: User|null; deletingId?: string|null })`.

- [ ] **Step 1: Convert `src/components/Sidebar.jsx` → `.tsx`** (worked example — full file)

```bash
git mv src/components/Sidebar.jsx src/components/Sidebar.tsx
```

```tsx
import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import ConversationList from './chat/ConversationList';
import UserMenu from './UserMenu';
import logo from '../assets/logo.png';
import type { ConversationSummary, User } from '../types';

interface SidebarProps {
    conversations?: ConversationSummary[];
    activeConversationId?: string | null;
    onNewChat?: () => void;
    onSelectConversation?: (id: string) => void;
    onDeleteConversation?: (id: string) => void;
    user?: User | null;
    deletingId?: string | null;
}

export default function Sidebar({
    conversations = [],
    activeConversationId,
    onNewChat = () => { },
    onSelectConversation = () => { },
    onDeleteConversation = () => { },
    user,
    deletingId
}: SidebarProps) {
    const [isExpanded, setIsExpanded] = useState(true);
    const location = useLocation();
    const isDocumentsPage = location.pathname === '/documents';

    return (
        <div className={`${isExpanded ? 'w-64' : 'w-16'} bg-sidebar border border-gray-300 flex flex-col transition-all duration-300 m-3 rounded-2xl overflow-hidden`}>
            {/* Header */}
            <div className="p-3 flex items-center justify-between">
                {isExpanded ? (
                    <>
                        <div className="flex items-center space-x-2">
                            <img src={logo} alt="Logo" className="w-10 h-8 object-contain" />
                            <span className="font-semibold text-text-primary text-sm md:text-base">Mera</span>
                        </div>
                        <button
                            onClick={() => setIsExpanded(false)}
                            className="p-1.5 hover:bg-bg-tertiary rounded-lg transition-colors"
                        >
                            <svg className="w-5 h-5 text-text-secondary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
                            </svg>
                        </button>
                    </>
                ) : (
                    <button
                        onClick={() => setIsExpanded(true)}
                        className="w-full p-1.5 hover:bg-bg-tertiary rounded-lg transition-colors flex justify-center"
                    >
                        <svg className="w-5 h-5 text-text-secondary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 5l7 7-7 7M5 5l7 7-7 7" />
                        </svg>
                    </button>
                )}
            </div>

            {/* Sidebar Content */}
            <div className="flex-1 flex flex-col">
                {isExpanded ? (
                    <>
                        <div className="p-3">
                            <button
                                onClick={onNewChat}
                                className="w-full flex items-center space-x-3 px-2 py-2.5 rounded-lg border border-border hover:bg-bg-tertiary transition-colors text-text-primary"
                            >
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                                </svg>
                                <span className="font-medium text-sm md:text-sm">New chat</span>
                            </button>
                        </div>

                        <nav className="px-3 space-y-1">
                            <Link
                                to="/documents"
                                className={`w-full flex items-center space-x-3 px-2 py-2 rounded-lg transition-colors ${isDocumentsPage
                                    ? 'bg-bg-tertiary text-text-primary'
                                    : 'hover:bg-bg-tertiary text-text-secondary'
                                    }`}
                            >
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                </svg>
                                <span className="text-sm md:text-sm">Documents</span>
                            </Link>
                            <button className="w-full flex items-center space-x-3 px-2 py-2 rounded-lg hover:bg-bg-tertiary transition-colors text-text-secondary">
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                                </svg>
                                <span className="text-sm md:text-sm">Library</span>
                            </button>
                        </nav>

                        <div className="flex-1 mt-4 overflow-y-auto min-h-0 custom-scrollbar">
                            <div className="px-3 mb-2">
                                <button className="w-full flex items-center justify-between text-text-secondary hover:text-text-primary transition-colors">
                                    <span className="text-xs md:text-sm font-medium text-gray-400 tracking-wide">Chats</span>
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                    </svg>
                                </button>
                            </div>
                            <ConversationList
                                conversations={conversations}
                                activeId={isDocumentsPage ? null : activeConversationId}
                                onSelect={onSelectConversation}
                                onDelete={onDeleteConversation}
                                deletingId={deletingId}
                            />
                        </div>
                    </>
                ) : (
                    <div className="flex flex-col items-center space-y-2 p-2 mt-2">
                        <button
                            onClick={onNewChat}
                            className="p-2.5 rounded-lg hover:bg-bg-tertiary transition-colors"
                            title="New chat"
                        >
                            <svg className="w-5 h-5 border-2 border-gray-500 rounded text-text-secondary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                            </svg>
                        </button>
                        <Link
                            to="/documents"
                            className={`p-2.5 rounded-lg transition-colors ${isDocumentsPage
                                ? 'bg-bg-tertiary text-text-primary'
                                : 'hover:bg-bg-tertiary text-text-secondary'
                                }`}
                            title="Documents"
                        >
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                            </svg>
                        </Link>
                        <button className="p-2.5 rounded-lg hover:bg-bg-tertiary transition-colors" title="Library">
                            <svg className="w-5 h-5 text-text-secondary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                            </svg>
                        </button>
                    </div>
                )}
            </div>

            {isExpanded && (
                <div className="px-2 py-1 border-t border-border">
                    <UserMenu user={user} />
                </div>
            )}
        </div>
    );
}
```

(Reformatted the JSX indentation/tag-splitting back to normal — the original file's indentation was scrambled, likely from an earlier auto-format pass; this is a pure whitespace fix with no behavior change, safe to include while touching the file.)

- [ ] **Step 2: Convert the remaining 5 root-level components**

Same procedure (rename, add `Props` interface, typecheck, fix):

- **`ConnectionStatus.jsx`** — `export default function ConnectionStatus({ status })`. `status: 'connected' | 'disconnected' | 'connecting' | string` (confirm the actual value set used at call sites during conversion — `SettingsPage.jsx` passes the literal `"connected"`; if other call sites pass different literal strings, use a plain `string` instead of a narrow union to avoid a false type error).
- **`QuotaWidget.jsx`** — `export default function QuotaWidget({ quota, warning, inline = false })`. `quota: QuotaStatus | null` (import from `../types`), `warning?: boolean`, `inline?: boolean`. Internal helpers: `formatTokens(n: number): string`, `formatTime(seconds: number): string`, `getColor(percent: number): string`, and inner component `ProgressBar({ label, used, limit, percent, extra }: { label: string; used: number; limit: number; percent: number; extra?: string })` (confirm `extra`'s exact type by reading the full file — it's the one prop not proven by the grep signature alone).
- **`SettingsPanel.jsx`** — `export default function SettingsPanel({ isOpen, onClose, settings, onSave, connectionStatus })`. `isOpen: boolean`, `onClose: () => void`, `settings: { communication_mode: string; show_timestamps: boolean; theme: string; welcome_message: string }` (matches the shape initialized in `ChatLayout.jsx` and `SettingsPage.jsx`), `onSave: (settings) => void`, `connectionStatus?: string`.
- **`Topbar.jsx`** — `export default function Topbar({ title, isNew })`. `title: string`, `isNew?: boolean`.
- **`UserMenu.jsx`** — `export default function UserMenu({ user })`. `user?: User | null` (import from `../types`).

- [ ] **Step 3: Typecheck the whole group**

Run: `npm run typecheck 2>&1 | grep -E "components/(Sidebar|ConnectionStatus|QuotaWidget|SettingsPanel|Topbar|UserMenu)\.tsx"`
Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add src/components/*.tsx
git commit -m "refactor: convert components/ root-level to TypeScript"
```

---

### Task 10: `layouts/ChatLayout.tsx`

**Files:**
- Modify: `src/layouts/ChatLayout.jsx` → `.tsx`

**Interfaces:**
- Consumes: `useAuth`, `useToast` (Task 4), `conversationService`, `apiService` (Task 3), `Sidebar` (Task 9), `ToastContainer` (Task 5), `logger` (Task 2), `ConversationSummary` (Task 3).
- Produces: the `Outlet` context shape every page under this layout consumes via `useOutletContext<ChatLayoutContext>()`:
  ```ts
  interface ChatLayoutContext {
      activeConversationId: string | null;
      settings: AppSettings;
      loadConversations: () => Promise<void>;
      setActiveConversationId: (id: string | null) => void;
      conversations: ConversationSummary[];
  }
  ```
  This `ChatLayoutContext` type is defined in `ChatLayout.tsx` and re-exported so `ChatPage.tsx`/`SettingsPage.tsx` (Task 11) can import it for their `useOutletContext<ChatLayoutContext>()` calls.

- [ ] **Step 1: Convert `src/layouts/ChatLayout.jsx` → `.tsx`**

```bash
git mv src/layouts/ChatLayout.jsx src/layouts/ChatLayout.tsx
```

```tsx
import { useState, useEffect } from 'react';
import { Navigate, Outlet, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import conversationService from '../services/conversationService';
import apiService from '../services/apiService';
import Sidebar from '../components/Sidebar';
import ToastContainer from '../components/ui/Toast';
import logger from '../utils/logger';
import type { ConversationSummary } from '../types';

export interface AppSettings {
    communication_mode: string;
    show_timestamps: boolean;
    theme: string;
    welcome_message: string;
}

export interface ChatLayoutContext {
    activeConversationId: string | null;
    settings: AppSettings;
    loadConversations: () => Promise<void>;
    setActiveConversationId: (id: string | null) => void;
    conversations: ConversationSummary[];
}

export default function ChatLayout() {
    const { user, isAuthenticated, isLoading } = useAuth();
    const { toasts, dismiss } = useToast();
    const navigate = useNavigate();
    const location = useLocation();

    const pathMatch = location.pathname.match(/^\/c\/(.+)/);
    const activeConversationId = pathMatch ? pathMatch[1] : null;

    const setActiveConversationId = (id: string | null) => navigate(id ? `/c/${id}` : '/');

    const [conversations, setConversations] = useState<ConversationSummary[]>([]);
    const [settings, setSettings] = useState<AppSettings>({
        communication_mode: 'streaming',
        show_timestamps: true,
        theme: 'light-green',
        welcome_message: ''
    });

    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
    const [itemToDelete, setItemToDelete] = useState<string | null>(null);
    const [deletingId, setDeletingId] = useState<string | null>(null);

    useEffect(() => {
        if (isAuthenticated) {
            loadConversations();
            loadSettings();
        }
    }, [isAuthenticated]);

    const loadConversations = async () => {
        try {
            const convs = await conversationService.getAllConversations();
            setConversations(convs);
        } catch (error) {
            logger.error('Error loading conversations:', error);
        }
    };

    const loadSettings = async () => {
        try {
            const settingsData = await apiService.get<AppSettings>('/settings');
            setSettings(settingsData);
        } catch (error) {
            logger.error('Error loading settings:', error);
        }
    };

    const handleNewChat = () => {
        navigate('/');
    };

    const handleSelectConversation = (id: string) => {
        navigate(`/c/${id}`);
    };

    const handleDeleteRequest = (id: string) => {
        setItemToDelete(id);
        setShowDeleteConfirm(true);
    };

    const confirmDelete = async () => {
        if (!itemToDelete) return;

        const id = itemToDelete;
        setShowDeleteConfirm(false);
        setDeletingId(id);

        setTimeout(async () => {
            setConversations(prev => prev.filter(c => c.id !== id));
            setDeletingId(null);
            setItemToDelete(null);

            if (activeConversationId === id) {
                const remaining = conversations.filter(c => c.id !== id);
                navigate(remaining.length > 0 ? `/c/${remaining[0].id}` : '/');
            }

            try {
                await conversationService.deleteConversation(id);
            } catch (error) {
                logger.error('Error deleting chat:', error);
                loadConversations();
            }
        }, 300);
    };

    const handleDeleteConversation = handleDeleteRequest;

    if (isLoading) {
        return (
            <div className="flex h-screen items-center justify-center bg-page">
                <div className="text-center">
                    <h2 className="text-xl font-semibold text-primary">Loading...</h2>
                </div>
            </div>
        );
    }

    if (!isAuthenticated && !localStorage.getItem('accessToken')) {
        return <Navigate to="/login" replace />;
    }

    return (
        <div className="flex h-screen bg-page text-text-primary">
            <Sidebar
                conversations={conversations}
                activeConversationId={activeConversationId}
                onNewChat={handleNewChat}
                onSelectConversation={handleSelectConversation}
                onDeleteConversation={handleDeleteConversation}
                user={user}
                deletingId={deletingId}
            />

            <div className="flex-1 flex flex-col h-full overflow-hidden bg-page relative">
                <ToastContainer toasts={toasts} onDismiss={dismiss} />
                <Outlet context={{
                    activeConversationId,
                    settings,
                    loadConversations,
                    setActiveConversationId,
                    conversations,
                } satisfies ChatLayoutContext} />
            </div>

            {showDeleteConfirm && (
                <div className="fixed inset-0 bg-black bg-opacity-40 backdrop-blur-sm flex items-center justify-center z-50 animate-fade-in">
                    <div className="bg-white rounded-xl p-6 max-w-sm w-full mx-4 shadow-2xl border border-border">
                        <h3 className="text-lg font-semibold text-gray-900 mb-2">Delete Conversation?</h3>
                        <p className="text-text-secondary mb-6">
                            This action cannot be undone. The conversation will be permanently removed.
                        </p>
                        <div className="flex space-x-3">
                            <button
                                onClick={() => setShowDeleteConfirm(false)}
                                className="flex-1 px-4 py-2 bg-white border border-border text-text-secondary hover:bg-bg-secondary rounded-lg transition-colors font-medium"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={confirmDelete}
                                className="flex-1 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors font-medium shadow-sm"
                            >
                                Delete
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck 2>&1 | grep "ChatLayout"`
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add src/layouts/ChatLayout.tsx
git commit -m "refactor: convert layouts/ChatLayout to TypeScript"
```

---

### Task 11: `pages/` (4 files)

**Files:**
- Modify: `src/pages/LoginPage.jsx` → `.tsx`
- Modify: `src/pages/DocumentsPage.jsx` → `.tsx`
- Modify: `src/pages/SettingsPage.jsx` → `.tsx`
- Modify: `src/pages/ChatPage.jsx` → `.tsx`

**Interfaces:**
- Consumes: `ChatLayoutContext` (Task 10), `useAuth` (Task 4), all services (Task 3), `ChatMessage`/`ChatInput`/`TypingIndicator`/`AgentTaskList` (Task 6), `DocumentSideViewer`/`DocumentListPanel`/`DocumentUploadZone`/`DocumentTable` (Task 7), `Topbar`/`ModeSelector`/`ConnectionStatus` (Tasks 9, 6, 9).

- [ ] **Step 1: Convert `src/pages/LoginPage.jsx` → `.tsx`**

```bash
git mv src/pages/LoginPage.jsx src/pages/LoginPage.tsx
```

Only change from the original: type the one untyped local (`handleSubmit`'s event, and the caught error):

```tsx
import { useState, useEffect, type FormEvent } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import logo from '../assets/logo.png';

export default function LoginPage() {
    const [isLogin, setIsLogin] = useState(true);
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [fullName, setFullName] = useState('');
    const [error, setError] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);

    const { login, register, isAuthenticated, isLoading } = useAuth();
    const navigate = useNavigate();

    useEffect(() => {
        if (!isLoading && isAuthenticated) {
            navigate('/', { replace: true });
        }
    }, [isAuthenticated, isLoading, navigate]);

    const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        setError('');
        setIsSubmitting(true);

        try {
            if (isLogin) {
                await login(email, password);
            } else {
                await register(email, password, fullName);
            }
            navigate('/');
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Authentication failed. Please check your credentials.';
            setError(message);
        } finally {
            setIsSubmitting(false);
        }
    };

    // JSX unchanged from the original file — copy verbatim, no prop/type changes needed
    // since this component takes no props and every local piece of state above is
    // already correctly inferred by useState's initial-value generics.
    return (
        // ...existing JSX from src/pages/LoginPage.jsx lines 42-141, unchanged...
        <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
            {/* full markup identical to the current file */}
        </div>
    );
}
```

(The JSX body itself doesn't reference anything requiring new types — during conversion, keep it byte-for-byte identical to the current file's return statement; only the imports and `handleSubmit` signature change as shown above.)

- [ ] **Step 2: Convert `src/pages/DocumentsPage.jsx` → `.tsx`**

```bash
git mv src/pages/DocumentsPage.jsx src/pages/DocumentsPage.tsx
```

No props, no untyped callbacks beyond what TS already infers from `useState(0)`. Rename only:

```tsx
import { useState } from 'react';
import DocumentUploadZone from '../components/document/DocumentUploadZone';
import DocumentTable from '../components/document/DocumentTable';
import Topbar from '../components/Topbar';

export default function DocumentsPage() {
    const [refreshTrigger, setRefreshTrigger] = useState(0);

    return (
        <div className="flex-1 flex flex-col h-full overflow-hidden">
            <Topbar title="Documents" />
            <main className="flex-1 overflow-y-auto p-8">
                <div className="max-w-5xl mx-auto space-y-8">
                    <DocumentUploadZone
                        onUploadComplete={() => setRefreshTrigger(t => t + 1)}
                    />
                    <DocumentTable refreshTrigger={refreshTrigger} />
                </div>
            </main>
        </div>
    );
}
```

- [ ] **Step 3: Convert `src/pages/SettingsPage.jsx` → `.tsx`**

```bash
git mv src/pages/SettingsPage.jsx src/pages/SettingsPage.tsx
```

Import `AppSettings` from `ChatLayout.tsx` (Task 10) instead of re-declaring the settings shape inline, and type the two local helper components (`Section`, `Toggle`, `Field`) plus `Memory` from `src/types`:

```tsx
import { useState, useEffect, type ReactNode } from 'react';
import { useAuth } from '../context/AuthContext';
import apiService from '../services/apiService';
import memoryService from '../services/memoryService';
import SimpleMDE from 'react-simplemde-editor';
import 'easymde/dist/easymde.min.css';
import ModeSelector from '../components/chat/ModeSelector';
import ConnectionStatus from '../components/ConnectionStatus';
import logger from '../utils/logger';
import type { AppSettings } from '../layouts/ChatLayout';
import type { Memory } from '../types';

const TABS = [
    { id: 'general', label: 'General', icon: 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z' },
    { id: 'memory', label: 'Memory', icon: 'M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z' },
    { id: 'profile', label: 'Profile', icon: 'M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z' },
    { id: 'appearance', label: 'Appearance', icon: 'M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01' },
    { id: 'connection', label: 'Connection', icon: 'M13 10V3L4 14h7v7l9-11h-7z' },
];

export default function SettingsPage() {
    const { user } = useAuth();
    const [activeTab, setActiveTab] = useState('general');
    const [settings, setSettings] = useState<AppSettings>({
        communication_mode: 'websocket',
        show_timestamps: true,
        theme: 'light-green',
        welcome_message: '',
    });
    const [saved, setSaved] = useState(false);

    const [memoryEnabled, setMemoryEnabled] = useState(true);
    const [memories, setMemories] = useState<Memory[]>([]);
    const [memoriesLoading, setMemoriesLoading] = useState(false);
    const [editingMemoryId, setEditingMemoryId] = useState<string | null>(null);
    const [editingContent, setEditingContent] = useState('');
    const [deletingMemoryId, setDeletingMemoryId] = useState<string | null>(null);

    useEffect(() => {
        loadSettings();
    }, []);

    useEffect(() => {
        if (activeTab === 'memory') {
            loadMemories();
            loadMemorySettings();
        }
    }, [activeTab]);

    const loadSettings = async () => {
        try {
            const data = await apiService.get<AppSettings>('/settings');
            setSettings(data);
        } catch (err) {
            logger.error('Failed to load settings:', err);
        }
    };

    const loadMemories = async () => {
        setMemoriesLoading(true);
        try {
            const data = await memoryService.getMemories();
            setMemories(data);
        } catch (err) {
            logger.error('Failed to load memories:', err);
        } finally {
            setMemoriesLoading(false);
        }
    };

    const loadMemorySettings = async () => {
        try {
            const data = await memoryService.getMemorySettings();
            setMemoryEnabled(data.enabled);
        } catch (err) {
            logger.error('Failed to load memory settings:', err);
        }
    };

    const handleToggleMemory = async (enabled: boolean) => {
        setMemoryEnabled(enabled);
        try {
            await memoryService.updateMemorySettings({ enabled });
        } catch (err) {
            logger.error('Failed to update memory settings:', err);
            setMemoryEnabled(!enabled);
        }
    };

    const handleStartEdit = (memory: Memory) => {
        setEditingMemoryId(memory.id);
        setEditingContent(memory.content);
    };

    const handleCancelEdit = () => {
        setEditingMemoryId(null);
        setEditingContent('');
    };

    const handleSaveMemory = async (memoryId: string) => {
        try {
            await memoryService.updateMemory(memoryId, editingContent);
            setMemories((prev) =>
                prev.map((m) => (m.id === memoryId ? { ...m, content: editingContent } : m))
            );
            setEditingMemoryId(null);
            setEditingContent('');
        } catch (err) {
            logger.error('Failed to update memory:', err);
        }
    };

    const handleDeleteMemory = async (memoryId: string) => {
        setDeletingMemoryId(memoryId);
    };

    const confirmDeleteMemory = async () => {
        if (!deletingMemoryId) return;
        try {
            await memoryService.deleteMemory(deletingMemoryId);
            setMemories((prev) => prev.filter((m) => m.id !== deletingMemoryId));
        } catch (err) {
            logger.error('Failed to delete memory:', err);
        } finally {
            setDeletingMemoryId(null);
        }
    };

    const handleSave = async () => {
        try {
            await apiService.put('/settings', settings);
            setSaved(true);
            setTimeout(() => setSaved(false), 2000);
        } catch (err) {
            logger.error('Failed to save settings:', err);
        }
    };

    // ...JSX body unchanged from the current file (lines 140-404)...

    return (
        <div className="h-full overflow-y-auto">
            {/* full markup identical to the current file */}
        </div>
    );
}

/* ---- Small helper components ---- */

function Section({ title, desc, children }: { title: string; desc?: string; children: ReactNode }) {
    return (
        <div>
            <h3 className="text-base font-semibold text-text-primary">{title}</h3>
            {desc && <p className="text-sm text-text-secondary mt-0.5 mb-4">{desc}</p>}
            {children}
        </div>
    );
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (checked: boolean) => void }) {
    return (
        <label className="relative inline-flex items-center cursor-pointer">
            <input
                type="checkbox"
                checked={checked}
                onChange={(e) => onChange(e.target.checked)}
                className="sr-only peer"
            />
            <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary"></div>
        </label>
    );
}

function Field({ label, value, readOnly }: { label: string; value: string; readOnly?: boolean }) {
    return (
        <div>
            <label className="block text-sm font-medium text-text-secondary mb-1.5">{label}</label>
            <input
                type="text"
                value={value}
                readOnly={readOnly}
                className="w-full bg-bg-secondary text-text-primary border border-border rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-all read-only:cursor-default read-only:opacity-70"
            />
        </div>
    );
}
```

Note: `useOutletContext()` was imported but its return value (`context`) was assigned and never read anywhere in the original file (confirm this during conversion — if still true, drop the now-pointless `const context = useOutletContext();` line entirely rather than typing a value nothing uses; if it turns out something does read it, type it as `useOutletContext<ChatLayoutContext>()` per Task 10).

- [ ] **Step 4: Convert `src/pages/ChatPage.jsx` → `.tsx`** (largest file in the app — 628 lines; do this one last)

```bash
git mv src/pages/ChatPage.jsx src/pages/ChatPage.tsx
```

Key typing points (apply while converting; keep all JSX and logic unchanged):

```tsx
import { useState, useEffect, useRef, useCallback } from 'react';
import { useOutletContext } from 'react-router-dom';
import { useToast } from '../context/ToastContext'; // DEMO - remove after testing
import ChatMessage from '../components/chat/ChatMessage';
import ChatInput from '../components/chat/ChatInput';
import TypingIndicator from '../components/chat/TypingIndicator';
import AgentTaskList from '../components/chat/AgentTaskList';
import DocumentSideViewer from '../components/document/DocumentSideViewer';
import DocumentListPanel from '../components/document/DocumentListPanel';
import Topbar from '../components/Topbar';
import conversationService from '../services/conversationService';
import apiService from '../services/apiService';
import streamingService from '../services/streamingService';
import agentStreamService from '../services/agentStreamService';
import websocketService from '../services/websocketService';
import documentService from '../services/documentService';
import logger from '../utils/logger';
import type { ChatLayoutContext } from '../layouts/ChatLayout';
import type { ChatMessage as ChatMessageType, DocumentItem, QuotaStatus } from '../types';
import type { AgentRunEvent, AgentDoneEvent } from '../services/agentStreamService';

const AGENT_NAME_MAP: Record<string, string> = {
    research: 'Research Agent',
    planner: 'Planning Agent',
    implement: 'Implementation Agent',
    testing: 'Testing Agent',
    report: 'Reporting Agent',
};

const SCROLL_THRESHOLD = 120;

interface AgentStep {
    id: string;
    label: string;
    status: 'pending' | 'processing' | 'completed' | 'failed';
}

interface AgentGroup {
    id: string;
    agentType: string;
    agentName: string;
    steps: AgentStep[];
}

interface ViewingDocument {
    doc: DocumentItem | { filename?: string; id?: string };
    pageStart?: string | null;
    pageEnd?: string | null;
}

interface SelectedDoc extends DocumentItem {
    active?: boolean;
}

export default function ChatPage() {
    const { activeConversationId, setActiveConversationId, settings, loadConversations, conversations } = useOutletContext<ChatLayoutContext>();
    const toast = useToast(); // DEMO - remove after testing
    const [messages, setMessages] = useState<ChatMessageType[]>([]);
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
    const [viewerWidth, setViewerWidth] = useState(400);

    const splitPaneRef = useRef<HTMLDivElement>(null);
    const viewerRef = useRef<HTMLDivElement>(null);
    const isResizing = useRef(false);
    const chatScrollRef = useRef<HTMLDivElement>(null);
    const userScrolledUp = useRef(false);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const justCreatedConversationId = useRef<string | null>(null);
    const draftDocsRef = useRef<Record<string, SelectedDoc[]>>({});
    const prevConvIdRef = useRef(activeConversationId);
    const thinkingTextRef = useRef('');
    const thinkingStartRef = useRef<number | null>(null);
    const thinkingDurationRef = useRef<number | null>(null);

    // ...rest of the component: copy the existing logic unchanged. Every function
    // below (startResizing, stopResizing, resize, handleChatScroll, scrollToBottom,
    // loadMessages, connectWebSocket, disconnectWebSocket, handleStop, handleAgentTask,
    // handleSendMessage, handleCitationClick, handleDocumentsConfirm,
    // handleDocumentRemove, handleDocumentToggle) already type-checks once the state/ref
    // generics above are in place and the service methods (Task 3) are typed — the only
    // extra annotations needed are on parameters TS can't infer from context:
    //   - `resize(e: MouseEvent)`
    //   - `handleAgentTask(taskId: string, conversationId: string | null)`
    //   - the three streamTask callbacks: `(event: AgentRunEvent) => {...}`,
    //     `(event: AgentDoneEvent) => {...}`, `(error: Error) => {...}`
    //   - `handleCitationClick(filename: string, pageStart: string | null, docId: string | null, pageEnd: string | null = null)`
    //   - `handleDocumentsConfirm(docs: DocumentItem[])`
    //   - `handleDocumentRemove(docId: string)` / `handleDocumentToggle(docId: string)`

    // ...JSX return unchanged from the current file (lines 508-628)...
}
```

Work through the file top to bottom, adding these signatures at each function definition (their bodies are unchanged), running `npm run typecheck` after each function to catch mismatches early rather than at the end of the whole 628-line file.

- [ ] **Step 5: Typecheck the whole group**

Run: `npm run typecheck 2>&1 | grep "pages/"`
Expected: no output.

- [ ] **Step 6: Manual smoke test**

`npm run dev`: log in, create a new chat, send a message, open Settings and toggle each tab, open Documents and upload a file. Confirm no new console errors versus the pre-migration behavior.

- [ ] **Step 7: Commit**

```bash
git add src/pages/*.tsx
git commit -m "refactor: convert pages/ to TypeScript"
```

---

### Task 12: `App.tsx` + `main.tsx` — entry point and final verification

**Files:**
- Modify: `src/App.jsx` → `.tsx`
- Modify: `src/main.jsx` → `.tsx`

**Interfaces:**
- Consumes: everything converted in Tasks 1–11. No new interfaces produced — this is the root of the dependency tree.

- [ ] **Step 1: Convert `src/App.jsx` → `.tsx`**

```bash
git mv src/App.jsx src/App.tsx
```

No props, no untyped locals — this file is pure JSX composition. Rename only:

```tsx
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { ToastProvider } from './context/ToastContext';
import LoginPage from './pages/LoginPage';
import DocumentsPage from './pages/DocumentsPage';
import ChatPage from './pages/ChatPage';
import SettingsPage from './pages/SettingsPage';
import ChatLayout from './layouts/ChatLayout';

function App() {
    return (
        <Router>
            <ToastProvider>
                <AuthProvider>
                    <Routes>
                        <Route path="/login" element={<LoginPage />} />

                        <Route element={<ChatLayout />}>
                            <Route path="/" element={<ChatPage />} />
                            <Route path="/c/:conversationId" element={<ChatPage />} />
                            <Route path="/documents" element={<DocumentsPage />} />
                            <Route path="/settings" element={<SettingsPage />} />
                        </Route>

                        <Route path="*" element={<Navigate to="/" replace />} />
                    </Routes>
                </AuthProvider>
            </ToastProvider>
        </Router>
    );
}

export default App;
```

- [ ] **Step 2: Convert `src/main.jsx` → `.tsx`**

```bash
git mv src/main.jsx src/main.tsx
```

The only real change: `document.getElementById('root')` returns `HTMLElement | null` in TS, but `ReactDOM.createRoot` requires a non-null `Element`. Assert it (the original code already assumed it's never null — `index.html` always has `<div id="root">` — so a non-null assertion documents that existing assumption rather than changing behavior):

```tsx
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
        <App />
    </React.StrictMode>,
)
```

- [ ] **Step 3: Full project typecheck**

Run: `npm run typecheck`
Expected: zero errors, for the entire project — this is the first point in the migration where the whole `src/` tree is TypeScript.

- [ ] **Step 4: Production build**

Run: `npm run build`
Expected: build succeeds (this also runs `tsc`-equivalent type-stripping via esbuild, but `typecheck` in Step 3 is the authoritative type check — `vite build` does not fail on type errors by default).

- [ ] **Step 5: Full manual smoke test**

Run: `npm run dev`. Walk through: login/register, new chat + send message (streaming mode), switch Settings → Communication Mode to WebSocket and send another message, upload a document and reference it in chat via citation, open Documents page and delete a document, toggle a Settings memory entry. Confirm no console errors anywhere in this walkthrough.

- [ ] **Step 6: Commit**

```bash
git add src/App.tsx src/main.tsx
git commit -m "refactor: convert App and main entry point to TypeScript — migration complete"
```

---

## Self-Review Notes

- **Spec coverage:** Tooling setup (Task 1), bottom-up order utils→services/types→context→hooks→ui→chat→document→viewer→root-components→layouts→pages→entry (Tasks 2–12, hooks folded into Task 2 alongside utils since it's a single trivial file — no separate task needed for one file), hand-written `src/types/` (Task 3), `vite-plugin-checker` (Task 1), strict mode (Task 1's `tsconfig.json`) — every spec section has a task.
- **Naming collision caught:** `DocumentItem` (not `Document`) and the `ChatMessage` component vs. `ChatMessage` type alias — both called out explicitly in Tasks 3 and 6 so the implementer doesn't hit a confusing global-type shadow error.
- **Type consistency check:** `ConversationSummary`, `ChatMessage`, `DocumentItem`, `QuotaStatus`, `Memory`, `User` (Task 3) are the exact names imported in Tasks 4, 5, 6, 7, 9, 10, 11 — no renames introduced across tasks. `ChatLayoutContext`/`AppSettings` (Task 10) are the exact names imported in Task 11's `SettingsPage.tsx` and `ChatPage.tsx`. `AgentRunEvent`/`AgentDoneEvent` (Task 3's `agentStreamService.ts`) are the exact names imported in Task 11's `ChatPage.tsx`.
- **Files not fully read during planning** (`AgentTaskList`, `ConversationList`, `ModeSelector`, `ThinkingBlock`, `TypingIndicator`, `DocumentDetailModal`, `DocumentListPanel`, `DocumentPickerModal`, `DocumentSideViewer`, `DocumentStatusBadge`, `DocumentTable`, `DocumentUploadZone`, `OcrViewerModal`, `ExcelViewer`, `MarkdownViewer`, `TextViewer`, `TSVViewer`, `WordViewer`, `ConnectionStatus`, `QuotaWidget`, `SettingsPanel`, `Topbar`, `UserMenu`): their top-level prop signatures were confirmed via a repo-wide grep (exact parameter names, no guessing), and each task states the concrete procedure (interface derived from the known destructured props, typed against `src/types` where the prop is a domain object) plus explicit call-outs anywhere a prop's exact shape needs confirming from the full file during conversion (e.g. `DocumentSideViewer`'s partial-document case, `QuotaWidget`'s `ProgressBar` `extra` prop, `DocumentUploadZone`'s local upload-item shape). This is intentional: for a same-behavior rename+type migration, the type for each remaining prop is derived mechanically from how the codebase already uses it, which is implementation-time work guided by `tsc`'s own error feedback (that's why Task 1 wires up `vite-plugin-checker` — errors surface immediately as each file converts), not something to pre-guess file-by-file in the plan.
