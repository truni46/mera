# CLAUDE.md

## Project Overview

AI Tutor Web — a full-stack conversational AI application.
- **Frontend:** React + Vite + Tailwind CSS
- **Backend:** Python FastAPI + asyncpg (PostgreSQL) + Redis
- **Vector DB:** Qdrant (switchable to PgVector / Milvus)

---

## Behavioral Guidelines

These reduce common LLM coding mistakes. They bias toward caution over speed; for trivial tasks, use judgment.

### 1. Think Before Coding
- Don't assume. Don't hide confusion. Surface tradeoffs.
- State assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them — don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

### 5. Never Read or Expose Secrets
- **Tuyệt đối không được đọc hoặc in ra các thông tin nhạy cảm** — ví dụ giá trị thật trong `.env`, `.env.local`, `.env.production`, credentials R2/DB/LLM/OCR, token, secret key, JWT, password, API key.
- Khi gỡ lỗi/config liên quan đến biến môi trường, **chỉ đọc tên biến và trạng thái có/không có giá trị** (ví dụ `print(os.getenv('R2_ENABLED'))`), không in giá trị thật của secret (không in `os.getenv('R2_ACCESS_KEY_ID')`), không log token/password dưới bất kỳ dạng nào.
- Không commit secret vào repository. Không đưa giá trị nhạy cảm vào commit message, comment, hay output trả về người dùng.

### 2. Simplicity First
- Minimum code that solves the problem. Nothing speculative.
- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.
- Ask: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

### 3. Surgical Changes
- Touch only what you must. Clean up only your own mess.
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it — don't delete it.
- When your changes create orphans: remove imports/variables/functions that YOUR changes made unused. Don't remove pre-existing dead code unless asked.
- The test: every changed line should trace directly to the user's request.

### 4. Goal-Driven Execution
- Define success criteria. Loop until verified.
- Transform tasks into verifiable goals:
  - "Add validation" → write tests for invalid inputs, then make them pass.
  - "Fix the bug" → write a test that reproduces it, then make it pass.
  - "Refactor X" → ensure tests pass before and after.
- For multi-step tasks, state a brief plan with a verify check per step.
- Strong success criteria let you loop independently; weak criteria ("make it work") require constant clarification.

---

## Naming Conventions

- **All function, method, and variable names** use **camelCase** in both backend (Python) and frontend (JavaScript/React).
  - 'getCurrentUser', 'loadConversations', 'handleSendMessage'
  - Do NOT use snake_case (e.g. 'get_current_user' is wrong).
- **Class names** use **PascalCase**: 'AuthService', 'RagRepository', 'MemoryFacade'.
- **File names** use **camelCase**: 'ragService.py', 'convRAG.py', 'apiService.js'.
- **React components** use **PascalCase** file names: 'ChatPage.jsx', 'UserMenu.jsx'.
- **Database columns** use **camelCase** in double-quotes: '"userId"', '"conversationId"', '"createdAt"'.

---

## Architecture Patterns

### Backend Module Structure

Every module follows this layout:
'''
modules/<name>/
├── router.py       # FastAPI routes (endpoints)
├── service.py      # Business logic (orchestration)
└── repository.py   # Data access layer (PostgreSQL + JSON fallback)
'''

### Single-File Provider Pattern

Providers (vectorstore, embedding, retriever, LLM) follow the same pattern as 'llm/llmProvider.py':
'''
Protocol (ABC)
ConcreteProviderA
ConcreteProviderB
ServiceWrapper (reads env, builds provider)
singleton = ServiceWrapper()
'''
All in **one file**. No separate files per provider.

### Singleton Exports

Each module exports a module-level singleton at the bottom:
'''python
ragService = RagService()
memoryFacade = MemoryFacade()
embeddingService = EmbeddingService()
'''

### Cross-Module Imports

Modules only import from other modules via their **public facade** (service.py / ragService.py):
'''
rag/           ← no imports from memory, knowledge, or message
memory/        ← imports rag/ragService only
knowledge/     ← imports rag/ragService only
message/       ← imports memory/service + rag/ragService
'''
Never import internal files (vectorstore.py, retriever.py, repository.py) from other modules.

### Database Dual-Mode

All repositories support both PostgreSQL and JSON file fallback:
'''python
if db.useDatabase and db.pool:
    async with db.pool.acquire() as conn:
        # asyncpg query
else:
    data = db.read_json("tableName")
    # JSON file operations
'''

---

## Error Handling Rules

### Always use try/catch with logging — never bare raise

**Bad:**
'''python
async def doSomething():
    result = await riskyOperation()  # crashes without context
    return result
'''

**Bad:**
'''python
async def doSomething():
    try:
        result = await riskyOperation()
        return result
    except Exception:
        raise  # no log, no context
'''

**Good:**
'''python
async def doSomething():
    try:
        result = await riskyOperation()
        return result
    except Exception as e:
        logger.error(f"doSomething failed: {e}")
        raise
'''

**Good (for background tasks that should not crash the caller):**
'''python
async def backgroundTask():
    try:
        await riskyOperation()
    except Exception as e:
        logger.error(f"backgroundTask failed: {e}")
        # Do NOT re-raise — this runs in asyncio.create_task()
'''

### Rules:
1. **Every 'try/except' must log the error** using 'logger.error(...)' or 'logger.warning(...)' before raising or returning.
2. **Include context in the log message** — the function name, relevant IDs, what was being attempted.
3. **Background tasks** (via 'asyncio.create_task()') must catch all exceptions and log them — never let them crash silently.
4. **Router endpoints** should catch exceptions, log them, and return proper HTTP errors:
   '''python
   except Exception as e:
       logger.error(f"Endpoint /foo failed: {e}")
       raise HTTPException(status_code=500, detail=str(e))
   '''
5. **Never use bare 'except:'** — always catch 'Exception as e' at minimum.

---

## Comment Rules

- **No decorative separators** — do not use '# ----', '# ====', '# ****' or any visual divider lines.
- **Keep comments minimal** — only comment when the code is not self-explanatory.
- **Simple format only**: '# <content>' — one line, no borders, no padding.
- **Docstrings** are preferred over comments for functions/classes.

---

## Frontend Conventions

- **Services** use class-based singletons: 'export default new APIService()'.
- **State management:** React Context for auth; layout-level state lifted via 'useOutletContext()'.
- **Routing:** React Router with 'ChatLayout' as the layout wrapper for all protected routes.
- **Responsive font sizing:** 'html { font-size: clamp(13px, 1.061vw, 16px); }' — 14.5px baseline at 14" (1366px).

### Component Organization

'''
src/components/
├── ui/                # Reusable UI primitives (AgentTaskList, Table, Card, Popup, Modal, Badge, ...)
├── ChatInput.jsx      # Feature-specific components at root level
├── ChatMessage.jsx
├── Sidebar.jsx
└── ...
'''

- **All generic/reusable UI components** go in 'components/ui/': tables, cards, popups, modals, badges, tooltips, spinners, etc.
- **Feature-specific components** (ChatInput, ChatMessage, Sidebar, ConversationList) stay at 'components/' root.
- Import UI components as: 'import AgentTaskList from '../components/ui/AgentTaskList''.

---

## Dev Server

- Frontend dev server runs on **port 5173** (do not auto-switch to other ports).
- Backend API runs on **port 3000** by default.
- If port 5173 is occupied, **ask the user** to kill the old process — do not silently switch ports.

---

## Python Environment

- **Always** use the root '.venv' (single venv for the whole project) for installing dependencies.
- Before 'pip install', activate the root '.venv':
  '''bash
  # From project root
  source .venv/bin/activate   # Linux/Mac
  .venv\Scripts\activate      # Windows
  pip install <package>
  '''
- Never install packages globally — always activate the venv first.
