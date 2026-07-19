# Variables Documentation

**Last updated:** 2026-07-19  
**Owner:** Product Analytics + Engineering

This catalog defines core application variables with professional, implementation-aligned descriptions. Each entry includes the variable name, friendly name, definition, formula, location in the apps, and an example value.

---

## Variable Relationship Chart

```mermaid
flowchart TB
  subgraph Entities
    Profile[Profile]
    Project[Project]
    Task[Task]
  end

  subgraph Progress bucketing
    PD[Progress day ISO]
    CBD[Completions by calendar day]
    DQ[Daily qualify map]
  end

  subgraph Weekly surface
    WTS[Weekday historical series]
    L7[last7Days calendar-week payload]
  end

  subgraph Gamification formulas
    XP[totalPoints / level / xpToNext]
    Streak[streakDays]
    MG[Monthly Grinding]
    YG[Yearly Grinding]
    BEM[Badges Earned Milestones]
    Cap[capMilestoneBadges]
  end

  subgraph APIs and UI
    Stats[GET /api/stats]
    Insights[GET /api/productivity-insights]
    Summary[POST /api/productivity-summary]
    Ask[POST /api/productivity-summary/ask]
    Desc[Achievement and milestone descriptions]
    UI[Gamification and analysis UI]
    Overlay[uiExclusiveOverlay]
    Toast[Single toast queue]
  end

  subgraph AI providers
    Groq[GROQ_API_KEY]
    Tavily[TAVILY_API_KEY]
  end

  subgraph Persistence and transfer
    Runtime[Tasks/projects/profiles]
    Store[DataStorage fs or Neon]
    Rev[tasks_revision]
    Staging[stagingPathname / transfer_staging]
    Auto[autoSyncAndSave]
  end

  Profile --> Project
  Profile --> Task
  Project --> Task
  Task --> PD
  PD --> CBD
  CBD --> DQ
  CBD --> WTS
  CBD --> L7
  WTS --> L7
  Task --> XP
  CBD --> Streak
  DQ --> MG
  MG --> YG
  XP --> Stats
  Streak --> Stats
  L7 --> Stats
  MG --> Stats
  YG --> Stats
  BEM --> Stats
  Cap --> Stats
  Stats --> Desc
  Desc --> UI
  Stats --> UI
  Task --> Insights
  Insights --> UI
  Task --> Summary
  Task --> Ask
  Groq --> Summary
  Groq --> Ask
  Tavily --> Summary
  Tavily --> Ask
  Summary --> UI
  Ask --> UI
  Overlay --> UI
  Toast --> Overlay
  Profile --> Runtime
  Project --> Runtime
  Task --> Runtime
  Runtime --> Store
  Store --> Rev
  Rev --> Store
  Staging --> Runtime
  Auto --> Store
```

---

## How to Read This Catalog

| Column | Meaning |
|---|---|
| **Variable Name** | Canonical identifier used in code or API payloads |
| **Friendly Name** | Human-readable label for product and analytics discussions |
| **Definition** | What the variable represents in product terms |
| **Formula** | Computation or generation rule (`n/a` when user-entered or opaque ID) |
| **App Location** | Primary files, routes, or UI surfaces |
| **Example** | Representative value |

---

## Entity Variables

### Profile Variables

| Variable Name | Friendly Name | Definition | Formula | App Location | Example |
|---|---|---|---|---|---|
| `profile.id` | Profile Identifier | Unique profile key used for scoping projects, tasks, and progress. | `PR-<13digit-ms>-<hex6>` | Backend profile routes; frontend active profile state | `PR-1777494302624-98735a` |
| `profile.name` | Profile Name | User-facing profile label; also used for policy gates (`Test`, performance toggle). | n/a | Profile hub; workspace selector; badge cards | `Rifqi Tjahyono` |
| `profile.title` | Profile Title | Secondary profile descriptor shown in headers and modals. | n/a | Profile hub; modal titles (`Profile: Name - Title`) | `Product Builder` |
| `profile.passwordHash` | Profile Security Hash | Optional hashed password for locked profile access and export control. | scrypt hash of password | `profileSecurity.ts`, profile unlock/delete/export | `$scrypt$...` |
| `pst.activeProfileId` | Active Profile Preference | Browser-persisted last selected profile id. | localStorage get/set | `frontend/src/App.tsx` | `PR-1777494302624-98735a` |

### Project Variables

| Variable Name | Friendly Name | Definition | Formula | App Location | Example |
|---|---|---|---|---|---|
| `project.id` | Project Identifier | Stable project key. | Normalized sequence | Project sidebar; task association | `P3` |
| `project.name` | Project Name | User-defined project label. | n/a | Project sidebar; filters; move dialog | `Workstream Alpha` |
| `project.profileId` | Project Profile Scope | Profile owner of the project. | n/a | Backend filters; frontend project loading | `PR-1777494302624-98735a` |

### Task Variables

| Variable Name | Friendly Name | Definition | Formula | App Location | Example |
|---|---|---|---|---|---|
| `task.id` | Task Identifier | Unique persisted task ID. | Generated id | Task CRUD APIs; list rendering | `t_89ab` |
| `task.title` | Task Title | Primary actionable label for a task. | n/a | Task card; editor; hovercard | `Prepare sprint plan` |
| `task.priority` | Priority | Urgency level for planning and XP scoring. | enum: `low` \| `medium` \| `high` \| `urgent` | Task UI; `scoreFor` in `/api/stats` | `high` |
| `task.dueDate` | Scheduled Date | Planned day for execution and preferred progress bucketing. | `YYYY-MM-DD` | List/calendar/progress bucketing | `2026-07-18` |
| `task.dueTime` | Scheduled Time | Planned start time. | `HH:mm` | Day agenda; time displays | `09:00` |
| `task.durationMinutes` | Duration Minutes | Planned effort duration. | integer minutes | Editor; agenda blocks; hover details | `90` |
| `task.repeat` | Recurrence Type | Repeat strategy for recurring tasks. | enum (daily/weekly/…/custom) | Recurrence logic and UI | `weekly` |
| `task.repeatEvery` | Recurrence Interval | Custom repeat interval factor. | positive integer | Custom repeat settings | `2` |
| `task.repeatUnit` | Recurrence Unit | Unit for custom interval. | enum | Recurrence settings | `week` |
| `task.labels` | Labels | Categorization tags. | string array | Chips; search/filter context | `["deep-work","planning"]` |
| `task.location` | Location Value | Optional location context text/URL payload. | n/a | Hovercard; editor | `Office` |
| `task.link` | External Links | Optional list of reference links. | string array | Hovercard; editor | `["https://example.com"]` |
| `task.profileId` | Task Profile Scope | Profile owner of the task. | Project/profile integrity rule | Backend scope filters; active profile | `PR-1777494302624-98735a` |
| `task.projectId` | Task Project Scope | Project association for grouping/filtering. | n/a | Project filters and cards | `P3` |
| `task.completed` | Completion Flag | Completion state for execution and scoring. | boolean toggle | List filters; stats APIs | `true` |
| `task.completedAt` | Completion Timestamp | Completion event timestamp. | `now()` on complete | Analytics; fallback progress day | `2026-07-18T12:01:00.000Z` |
| `task.parentId` | Series Parent ID | Deterministic recurring-series parent key. | Normalization function | Recurrence grouping | `20260718-3` |
| `task.childId` | Series Child ID | Sequence identifier within a recurring series. | Normalization function | Occurrence-level operations | `7` |

---

## Priority Scoring Variables

| Variable Name | Friendly Name | Definition | Formula | App Location | Example |
|---|---|---|---|---|---|
| `scoreFor(task)` | Priority XP Weight | Points awarded for a completed task based on priority. | `low=1`, `medium=2`, `high=3`, `urgent=4`, else `0` | `backend/src/index.ts` (`/api/stats`, insights) | `3` for `high` |
| `stats.pointsByPriority` | XP by Priority Band | Lifetime XP summed into priority buckets. | sum `scoreFor` per priority among completed tasks | `/api/stats` | `{ low: 12, medium: 40, high: 90, urgent: 28 }` |

---

## Derived Progress and Gamification Variables

| Variable Name | Friendly Name | Definition | Formula | App Location | Example |
|---|---|---|---|---|---|
| `completionDateIsoLocalForTask` | Progress Day | Day bucket key for completed task metrics. | Prefer `task.dueDate`; else local calendar date of `completedAt` | Backend stats and insights | `2026-07-18` |
| `stats.totalPoints` | Lifetime XP | Total weighted points over completed tasks in scope. | `sum(scoreFor(task))` | `/api/stats`; gamification UI | `420` |
| `stats.level` | Gamification Level | Progress level based on lifetime XP. | `1 + floor(totalPoints / 50)` | `/api/stats`; UI | `9` |
| `stats.xpToNext` | XP To Next Level | Remaining points until next level threshold. | If `totalPoints % 50 == 0` then `50`, else `50 - (totalPoints % 50)` | `/api/stats` | `30` |
| `stats.completedToday` | Completed Today | Completed tasks mapped to today’s progress day. | `count(progressDay == todayLocal)` | Gamification panel | `4` |
| `stats.pointsToday` | XP Today | XP earned on today’s progress day. | `sum(scoreFor)` for today’s completions | Gamification panel | `11` |
| `stats.streakDays` | Streak Days | Consecutive local days with ≥1 completion. | Backward count over progress-day buckets from today | Gamification panel | `6` |

---

## Policy and UX Variables

| Variable Name | Friendly Name | Definition | Formula | App Location | Example |
|---|---|---|---|---|---|
| `activeProfileName` | Active Profile Name | Currently selected profile name used for policy gates in UI. | `lookup(profile.id == activeProfileId).name` | `TaskBoard.tsx`, `ProjectSidebar.tsx` | `Test` |
| `isShowcaseReadOnlyActive` | Showcase Read-only Flag | Disables mutation interactions for profile `Test`. | `lower(trim(activeProfileName)) == "test"` | Task/project/profile components | `true` |
| `SHOWCASE_READONLY_MESSAGE` | Showcase Policy Message | Canonical backend message for blocked read-only mutations. | Constant string | `backend/src/index.ts` | `Showcase mode: profile "Test" is read-only...` |
| `getFriendlyErrorMessage` | Friendly Error Message | Human-readable error root cause shown in toaster UI. | Prefer backend error text; else fallback by HTTP status (incl. `413`) | `frontend/src/utils/friendlyError.ts` | `Verification failed. Please re-check your password...` |

---

## `/api/stats` Weekly Series and Tooltip Variables

The JSON key `last7Days` is a **legacy name**. Shipped behavior: an ordered array of **seven** objects for the **current calendar week** in the server’s local timezone (**Monday through Sunday**), not a rolling trailing-seven-day window.

| Variable Name | Friendly Name | Definition | Formula / Derivation | App Location | Example |
|---|---|---|---|---|---|
| `stats.last7Days` | Weekly Progress Series | Seven day-buckets for charting and achievement checks that iterate this array. | Week starts Monday 00:00 local; `i = 0..6` | `GET /api/stats`; `GamificationPanel.tsx` | Array length `7` |
| `stats.last7Days[].date` | Series Day | ISO calendar date for the bar. | Local `YYYY-MM-DD` | Stats payload; chart axis | `2026-07-13` |
| `stats.last7Days[].completed` | Completions Count | Tasks completed on that progress day. | Count where `completionDateIso === date` | Chart height; tooltip | `3` |
| `stats.last7Days[].points` | Day XP | Sum of priority weights for tasks completed that day. | `sum(scoreFor(task))` | Tooltip; achievements | `7` |
| `stats.last7Days[].taskXpMin` | Per-task XP Minimum | Smallest priority score among tasks completed that day. | `min(xps)` or `null` | Rich tooltip | `2` |
| `stats.last7Days[].taskXpMax` | Per-task XP Maximum | Largest priority score among tasks completed that day. | `max(xps)` or `null` | Rich tooltip | `4` |
| `stats.last7Days[].taskXpAvg` | Per-task XP Average | Mean priority score for tasks completed that day (one decimal). | `round((points / n) * 10) / 10` or `null` | Rich tooltip | `2.7` |
| `stats.last7Days[].weekdayTaskMin` | Weekday Historical Minimum | Min completions on this weekday across the filtered timeline (including zero days). | `min(count per weekday)` | Rich tooltip | `0` |
| `stats.last7Days[].weekdayTaskMax` | Weekday Historical Maximum | Max completions on this weekday over the same span. | `max(count per weekday)` | Rich tooltip | `5` |
| `stats.last7Days[].weekdayTaskAvg` | Weekday Historical Average | Mean completions for this weekday (one decimal). | `round(mean * 10) / 10` | Rich tooltip | `2.4` |

**Implementation note:** Achievements that loop over `last7Days` (for example Consistency Builder progress) use the **same seven calendar-week dates** as the weekly chart. Card copy describes this as “every day for 7 days.”

---

## Grinding and Milestone Variables

| Variable Name | Friendly Name | Definition | Formula | App Location | Example |
|---|---|---|---|---|---|
| `dailyQualifies` | Consistency Day Map | Map of ISO date → whether the day qualifies for Consistency Builder. | Derived from completion rules in stats builder | `monthlyGrinding.ts`, `yearlyGrinding.ts` | `Map{"2026-07-13" => true}` |
| `monthlyGrinding.monthKey` | Monthly Grinding Month | Calendar month under evaluation. | `YYYY-MM` from local month start | `computeMonthlyGrinding` | `2026-07` |
| `monthlyGrinding.weeksCompleted` | Monthly Grinding Weeks | Count of Monday-start weeks (Mon–Sun) whose Monday falls in the month and all 7 days qualify. | Count qualifying weeks | `monthlyGrinding.ts`; `/api/stats` | `3` |
| `monthlyGrinding.evidenceWeekStarts` | Monthly Evidence Mondays | ISO Mondays of qualifying weeks. | List of week starts | Stats / achievements | `["2026-07-06","2026-07-13"]` |
| `yearlyGrinding.year` | Yearly Grinding Year | Calendar year under evaluation. | Integer year | `yearlyGrinding.ts` | `2026` |
| `yearlyGrinding.monthsCompleted` | Yearly Grinding Months | Months that hit Monthly Grinding threshold. | Count months where `weeksCompleted >= 4` | `yearlyGrinding.ts`; `/api/stats` | `2` |
| `badgesEarned.milestones` | Badges Earned Tiers | Milestone thresholds for badges earned. | Every `5` from `5` to `750` (150 tiers) | `badgesEarnedMilestone.ts` | `[5,10,...,750]` |
| `badgesEarned.description` | Badges Earned Description | Plain-English explanation shown under the milestone card title. | Constant string | `badgesEarnedMilestone.ts`; `GamificationPanel.tsx` | `Rewards for collecting badges themselves (every 5 badges).` |
| `badgesEarned.progressToNext` | Progress to Next Badge Tier | Fraction toward the next badges-earned milestone. | `(current - prev) / (next - prev)` clamped to `[0,1]`; `1` if no next | `buildBadgesEarnedMilestoneBlock` | `0.4` |
| `badgesEarned.recentUnlocked` | Recent Badge Tiers | Last up to six achieved badge tiers. | `achieved.slice(-6)` | Stats UI | `[20,25,30,35,40,45]` |
| `milestones.*.description` | Milestone Card Description | Short plain-English line under each milestone card title (streak, tasks, XP, levels, badges earned). | Constant per milestone block in `/api/stats` | `backend/src/index.ts`; `GamificationPanel.tsx` | `Rewards for keeping a consecutive-day streak.` |
| `achievements.*.description` | Achievement Card Description | Short plain-English goal text on achievement cards. | Constant per achievement in `/api/stats` | `backend/src/index.ts`; `GamificationPanel.tsx` | `Earn at least 5 XP today.` |
| `capMilestoneBadges(values, max)` | Capped Milestone List | Caps long milestone lists for UI while preserving dense early tiers and the final milestone. | Keep ~66% head; sample tail; always include last | `capMilestoneBadges.ts` | Length `maxBadges` |

### Canonical achievement copy (shipped)

| Achievement ID | Friendly Name | Shipped Description |
|---|---|---|
| `early_starter` | Productive Day | Finish 3 tasks scheduled before 9 PM today. |
| `daily_grinding` | Daily Grinding | Earn at least 5 XP today. |
| `consistency_builder` | Consistency Builder | Hit both Productive Day and Daily Grinding every day for 7 days. |
| `monthly_grinding` | Monthly Grinding | Complete 4 full weeks in one month where every day hits both daily goals. |
| `yearly_grinding` | Yearly Grinding | Hit Monthly Grinding in all 12 months of the year. |

---

## Storage, Environment, and Transfer Variables

| Variable Name | Friendly Name | Definition | Formula | App Location | Example |
|---|---|---|---|---|---|
| `STORAGE_BACKEND` | Storage Backend Selector | Forces persistence adapter. | `fs` \| `neon` \| unset/`auto` | `createStorage.ts`; `.env` | `neon` |
| `DATABASE_URL` | Neon Pooled Connection | Primary Postgres connection string for Neon Free (prefer `-pooler` host). | Env secret | `neonClient.ts`; `createStorage.ts` | `postgresql://…@ep-….neon.tech/neondb?sslmode=require` |
| `DATABASE_URL_UNPOOLED` | Neon Unpooled Connection | Optional direct URL for migrations / admin. | Env secret | `neonClient.ts` | `postgresql://…@ep-….neon.tech/neondb?sslmode=require` |
| `NEON_FRESHNESS_TTL_MS` | Freshness Peek Cooldown | Minimum ms between `tasks_revision` peeks. | Default `2000` | Freshness path in `index.ts` | `2000` |
| `NEON_TRANSFER_TTL_HOURS` | Staging Expiry Hours | How long `transfer_staging` rows remain valid. | Default `2` | `transferStaging` / `neonStorage` | `2` |
| `NEON_STATEMENT_TIMEOUT_MS` | Statement Timeout | Fail-fast query budget under cold/load. | Default `15000` | `neonClient.ts` | `15000` |
| `FRONTEND_ORIGIN` | Allowed Frontend Origin | CORS lock for production API. | Required when `NODE_ENV`/`FOCISTA_ENV` is production | `backend/src/index.ts` | `https://app.vercel.app` |
| `GROQ_API_KEY` | Groq API Key | Server-only key for Productivity Summary LLM completions. | Required unless client sends `groqApiKey` | `productivitySummaryService.ts`; backend `.env` | `gsk_...` |
| `TAVILY_API_KEY` | Tavily API Key | Server-only key for optional web enrich in Productivity Summary. | Optional; client may send `tavilyApiKey` | `productivitySummaryService.ts`; backend `.env` | `tvly-...` |
| `pst.aiKeys` | Local AI Keys | Browser localStorage JSON `{ groqApiKey, tavilyApiKey }` for Productivity Summary. | User-entered via **AI keys** header | `frontend/src/aiKeys.ts`; `AiKeysModal.tsx` | `{ "groqApiKey":"gsk_…" }` |
| `GROQ_MODEL` | Groq Model Override | Chat model id for Groq completions. | Default `llama-3.3-70b-versatile` | `productivitySummaryService.ts` | `llama-3.3-70b-versatile` |
| `VITE_API_BASE_URL` | Frontend API Base URL | API origin for split hosting. | Required on Vercel Production when split | `apiClient.ts`; frontend env | `https://api.example.com` |
| `import.stagingPathname` | Import Staging Path | Staged import pathname instead of inline content. | Exactly one of `content` or `stagingPathname` | `POST /api/admin/import`; `App.tsx`; `transferImport.ts` | `focista-schedulo/imports/...` |
| `export.downloadUrl` | Export Staging Download | Short-lived API download URL for large staged export. | Issued when inline body would exceed limits | `POST /api/admin/export-data`; export-download route | `/api/admin/export-download?...` |
| `transfer_staging` | Transfer Staging Table | Neon table holding temporary import/export payloads. | Rows expire via `NEON_TRANSFER_TTL_HOURS` | `001_neon_core.sql`; `neonStorage.ts` | pathname + content |
| `autoSyncAndSave` | Automated Sync and Save | Client orchestration that syncs then saves after import (quiet optional). | Sequential admin calls | `frontend/src/App.tsx` | Quiet post-import run |
| `X-Server-Time-Ms` | Server Timing Header | Backend processing time for the request. | Middleware measured ms | Express middleware | `42` |
| `claimExclusiveTooltip` | Exclusive Tooltip Claim | Registers the single active tooltip/hovercard closer; dismisses any previous owner. | Module singleton closer slot | `frontend/src/uiExclusiveOverlay.ts`; TaskBoard, GamificationPanel, ProductivityAnalysisModal | Release fn from claim |
| `dismissExclusiveTooltip` | Exclusive Tooltip Dismiss | Closes the active exclusive tooltip (e.g. before showing a toast). | Invoke registered closer | `uiExclusiveOverlay.ts`; `App.tsx` `enqueueToast` | n/a |
| `toast.singleSlot` | Single Toast Queue | Only one toast is retained in the queue (replace, do not stack). | `setToasts` keeps latest non-duplicate toast | `App.tsx` `enqueueToast` | One toast object |
| `export.delivery` | Export Delivery Mode | How large exports are delivered to the client (request preference). | `auto` \| `inline` \| `staging` \| `parts` | `/api/admin/export-data` | `auto` |
| `droppedRows` | Import Skip Counts | Counts of projects/tasks/profiles skipped during per-row import validation. | `{ projects, tasks, profiles }` integers | import response payload; import toast | `{ tasks: 2, projects: 0, profiles: 0 }` |
| `persistDebounceMs` | Persistence Debounce | Delay before flushing dirty entities to storage. | `fs` ≈ 40; Neon ≈ 200 off-Vercel; Neon **`0`** when `VERCEL` set | `DataStorage` / `neonStorage.ts` | `0` on Vercel |
| `tasks_revision` | Tasks Revision Counter | Monotonic Neon `runtime_meta` value bumped on task writes. | Increment on persist | `runtime_meta`; `neonStorage.ts` | `42` |
| `ensureTasksMemoryFresh()` | Tasks Memory Freshness | Reloads in-memory tasks when remote `tasks_revision` is newer (Vercel multi-isolate). | Peek revision → `loadData` if newer | `GET /api/tasks`, `PATCH .../complete` | n/a |

---

## Productivity Summary and Search Variables

| Variable Name | Friendly Name | Definition | Formula | App Location | Example |
|---|---|---|---|---|---|
| `SummaryPeriod` | Summary Timeline Period | Period selector for AI Summary / Ask. | Enum: `day`, `week`, `sprint`, `month`, `bimonth`, `quarter`, `semester`, `year`, `next_*` variants, `custom` | `productivitySummaryService.ts`; `ProductivitySummaryModal.tsx` | `next_sprint` |
| `DateRange` | Resolved Period Range | Inclusive local date range for a summary period. | `{ startDate, endDate, period, label }` from `resolvePeriodRange()` | Summary service + API response | `{ startDate:"2026-07-13", endDate:"2026-07-26", period:"sprint", label:"This sprint" }` |
| `TaskDigestStats.completionRate` | Period Completion Rate | Share of non-cancelled tasks completed in range. | `round((completed / (totalInRange - cancelled)) * 1000) / 10` | Digest stats / Summary metrics | `72.5` |
| `summary.degraded` | Degraded Summary Flag | True when response used local digest brief because Groq failed. | Boolean on Summary/Ask response | API + Summary modal banner | `true` |
| `taskSearch.tokens` | Search Tokens | Whitespace-split query tokens; all must match. | `query.trim().split(/\s+/)` AND semantics | `taskSearch.ts`; TaskBoard | `["sprint","urgent"]` |
| `taskSearch.haystack` | Searchable Task Text | Concatenated searchable attributes for a task (incl. project/profile names). | Built per task from fields + context maps | `taskSearch.ts` | Includes title, labels, dates, ids… |
| `niceYDomain(min,max)` | Nice Y Domain | Snaps raw chart extent onto a clean tick grid. | Nice-number snapping with optional tight integer mode | `chartYAxis.ts`; Analysis charts | `{ yMin:0, yMax:10 }` |
| `buildYTicks(yMin,yMax)` | Y-Axis Ticks | Evenly spaced ticks with endpoints exact; no duplicate compact labels. | Step from nice domain; dedupe formatted labels | `chartYAxis.ts` | `[0, 2, 4, 6, 8, 10]` |

---

## Persistence Object Variables

| Variable Name | Friendly Name | Definition | Formula | App Location | Example |
|---|---|---|---|---|---|
| `tasks` (Neon) / `tasks.runtime.json` (fs) | Tasks Runtime Store | Primary task persistence (Neon: one row per task with `payload jsonb`). | Serialized task array/object or row upserts | `neonStorage.ts`; `backend/data/` | Runtime rows/files |
| `projects` / `projects.runtime.json` | Projects Runtime Store | Primary project persistence. | Serialized projects / relational rows | Same | Runtime rows/files |
| `profiles` / `profiles.runtime.json` | Profiles Runtime Store | Primary profile persistence; fast-path boot load. | Serialized profiles / relational rows | Same | Runtime rows/files |
| `runtime_meta` | Runtime Revision Meta | Neon keys for multi-isolate freshness (`tasks_revision`, …). | Monotonic counters | `001_neon_core.sql` | `tasks_revision=42` |
| `focista-unified-data.json` | Unified Interchange Snapshot | Import/export oriented snapshot, not primary mutation store. | Combined entities | Admin sync/import/export | Unified JSON |

---

## Notes on Source of Truth

- Runtime entity truth is persisted as Neon rows (Prod) or split JSON files (local `fs`) — same Task/Project/Profile schemas at the API boundary.
- Local path: `backend/data/` when `STORAGE_BACKEND=fs` (default without `DATABASE_URL`).
- Prod path: Neon Postgres Free when `STORAGE_BACKEND=neon` (or auto with `DATABASE_URL`).
- Metrics truth is computed server-side from persisted runtime entities.
- Unified JSON is interchange-oriented and not the primary runtime mutation store.
- Error-message source of truth is `frontend/src/utils/friendlyError.ts`.
- Weekly chart semantics source of truth is the `/api/stats` builder in `backend/src/index.ts` (calendar week under key `last7Days`).

---

## Related Documents

- Metrics: `PRODUCT_METRICS.md`
- OKRs: `METRICS_AND_OKRS.md`
- API: `API_CONTRACTS.md`
- Architecture: `ARCHITECTURE.md`
- Guardrails: `GUARDRAILS.md`
