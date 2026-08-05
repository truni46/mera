# TypeScript Migration (Frontend) — Design

## Goal

Convert the entire Mera frontend (React + Vite, `src/`) from JavaScript
(`.jsx`/`.js`) to TypeScript (`.tsx`/`.ts`) in one pass, with `strict: true`
from the start. The backend (Python/FastAPI) is out of scope — TypeScript
doesn't apply there, and Python's own type hints are a separate concern.

## Current State

- 43 `.jsx` files, 9 `.js` files under `src/`, no `tsconfig.json`.
- `@types/react` and `@types/react-dom` are already installed
  (unused leftovers); `typescript` itself is not installed.
- No PropTypes usage anywhere — nothing to strip out.
- No ESLint config exists — not introducing one as part of this migration
  (out of scope; a separate decision if wanted later).
- No test runner configured — nothing to update on that front.
- `src/` layout: `assets/`, `components/` (`ui/`, `chat/`, `document/`,
  `viewer/`, plus root-level feature components), `context/`
  (`AuthContext.jsx`, `ToastContext.jsx`), `hooks/` (`useDelayedSpinner.js`),
  `layouts/` (`ChatLayout.jsx`), `pages/` (`LoginPage`, `SettingsPage`,
  `ChatPage`), `services/` (7 files: `apiService`, `conversationService`,
  `documentService`, `memoryService`, `agentStreamService`,
  `streamingService`, `websocketService`), `utils/` (`logger.js`).

## Decisions

- **Scope:** whole frontend, single migration pass (not incremental
  file-by-file over time).
- **Strictness:** `strict: true` in `tsconfig.json` from day one — no
  loosened `noImplicitAny` transition period.
- **API types:** hand-written interfaces in `src/types/`, not generated
  from FastAPI's OpenAPI schema. Simpler, no new build-time dependency on
  the backend being reachable, at the cost of manually keeping them in
  sync with backend response shapes when those change.
- **Dev-time type checking:** add `vite-plugin-checker` so type errors
  surface as an in-browser overlay during `npm run dev`, matching how
  runtime errors already show up. A `typecheck` npm script (`tsc --noEmit`)
  covers full-project checks (CI, pre-commit, etc.).

## Tooling & Config Changes

- Add devDependencies: `typescript`, `@types/node`, `vite-plugin-checker`.
  Keep the already-installed `@types/react` / `@types/react-dom`.
- New `tsconfig.json` (app code): `strict: true`, `jsx: "react-jsx"`,
  `moduleResolution: "bundler"`, `target: "ES2020"` (Vite's own default
  baseline, since `vite.config.js` doesn't currently override `build.target`),
  `include: ["src"]`.
- New `tsconfig.node.json`: covers `vite.config.ts` itself (runs under
  Node, not the browser DOM lib).
- `vite.config.js` → `vite.config.ts`; add the `checker({ typescript: true })`
  plugin alongside the existing `@vitejs/plugin-react`.
- `index.html`: entry script path `/src/main.jsx` → `/src/main.tsx`.
- `package.json`: add `"typecheck": "tsc --noEmit"` script.

## Conversion Order

Bottom-up by dependency direction, so that by the time a file is converted,
everything it imports already has types — minimizes cascading `any`s and
rework:

1. **`utils/`** — `logger.js` (no internal deps)
2. **`services/`** — all 7 files. Also where `src/types/` is introduced:
   shared interfaces per backend domain (`conversation.ts`, `message.ts`,
   `document.ts`, `user.ts`, etc.), field names in camelCase to match the
   backend's Postgres columns / JSON responses (per project convention).
3. **`context/`** — `AuthContext.jsx`, `ToastContext.jsx` (depend on services)
4. **`hooks/`** — `useDelayedSpinner.js`
5. **`components/ui/`** — generic primitives (Table, Card, Modal, Badge, …)
6. **`components/`** — everything else (`chat/`, `document/`, `viewer/`,
   root-level components like `Sidebar.jsx`, `ChatInput.jsx`)
7. **`layouts/`** — `ChatLayout.jsx`
8. **`pages/`** — `LoginPage`, `SettingsPage`, `ChatPage`
9. **`main.jsx` → `main.tsx`** — entry point, converted last

Each step: rename extension, add types (props interfaces for components,
param/return types for functions), fix resulting `tsc` errors before
moving to the next step. Since strict mode is on from the start, expect
real type errors to surface (e.g. nullable values from API responses,
event handler types) — these get fixed properly, not silenced with `any`.

## Error Handling

Not applicable in the runtime sense — this is a build-tooling migration.
The "error handling" here is: `vite-plugin-checker` surfaces type errors
during dev immediately; `npm run typecheck` is the authoritative full-project
check to run before considering the migration step (or the whole migration)
done.

## Testing

No test suite exists currently, so there's nothing to port. Verification
is: `npm run typecheck` passes with zero errors, `npm run build` succeeds,
and the app is manually smoke-tested (login, chat, settings, document
upload) after each major step (services, then components, then pages) to
confirm no runtime regressions were introduced during the rename/type pass.

## Out of Scope

- Backend typing (Python/FastAPI) — separate concern, not TypeScript.
- Generating types from the OpenAPI schema — explicitly declined in favor
  of hand-written interfaces.
- Introducing ESLint — none exists today; not adding one as a side effect
  of this migration.
- Implementing the "Dark" theme stub in `SettingsPage.jsx` — unrelated,
  left as-is.
