# Docs-Code Crosswalk

**Last updated:** 2026-04-30  
**Owner:** Engineering + Product Operations

This file maps documentation artifacts to the primary implementation locations.

---

| Documentation Area | Primary Code References |
|---|---|
| Product shell and orchestration | `frontend/src/App.tsx` |
| Profile management and scope | `frontend/src/components/ProfileManagement.tsx`, profile routes in `backend/src/index.ts` |
| Task CRUD and list/calendar UX | `frontend/src/components/TaskBoard.tsx`, task routes in `backend/src/index.ts` |
| Task editor and parsing | `frontend/src/components/TaskEditorDrawer.tsx` |
| Project management | `frontend/src/components/ProjectSidebar.tsx`, project routes in `backend/src/index.ts` |
| Progress panel and badges | `frontend/src/components/GamificationPanel.tsx`, `/api/stats` in `backend/src/index.ts` |
| Productivity analysis | `frontend/src/components/ProductivityAnalysisModal.tsx`, `/api/productivity-insights` |
| Runtime persistence model | persistence helpers in `backend/src/index.ts`, `backend/data/*.runtime.json` |
| Import/export/sync/save admin flows | admin routes in `backend/src/index.ts`, actions in `frontend/src/App.tsx` and `TaskBoard.tsx` |
| Performance instrumentation | action logging in `TaskBoard.tsx`, `X-Server-Time-Ms` header middleware in backend |
| Friendly error root-cause formatting | `frontend/src/utils/friendlyError.ts`, integrated in `App.tsx`, `TaskBoard.tsx`, `ProfileManagement.tsx` |
| Showcase read-only policy | mutation guards in `backend/src/index.ts`, UI disable gates in profile/project/task components |
| Production API base URL / split hosting | `frontend/src/apiClient.ts`, `frontend/.env.example`, `frontend/vercel.json`, `docs/DEPLOYMENT_VERCEL.md` |
| Optional production CORS lock | `FRONTEND_ORIGIN` in `backend/src/index.ts`, `backend/.env.example` |

---

## Verification Checklist

- Docs mention split runtime persistence (not monolith runtime)
- Profile-scoped behavior reflected in product and technical docs
- API route inventory matches backend route declarations
- Metrics/variable formulas match current backend calculations

