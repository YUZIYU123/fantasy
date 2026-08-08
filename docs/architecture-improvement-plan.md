# Architecture Improvement Plan

## Outcome

Replace four clusters of shallow modules with vertical deep modules while preserving existing HTTP paths, response shapes, authorization, and reader-visible behavior. Work proceeds one phase at a time; each phase must finish and pass its gates before the next begins.

Domain terms in this plan follow [`CONTEXT.md`](../CONTEXT.md). The architectural shape follows [ADR-0001](./adr/0001-deep-vertical-modules.md).

## Constraints

- Preserve the current mobile-first reader experience and existing HTTP routes.
- Keep **审核状态** independent from **上线状态**.
- Keep **平台作品** distinct from **作者作品**; administrator capability does not imply ownership.
- A **回退** creates a new, monotonically increasing **发布版本**.
- Introduce a seam only when at least two adapters exist. D1 remains an internal dependency of D1-backed modules rather than gaining a hypothetical repository port.
- Replace old implementation and redundant tests after the new module interface is covered; do not leave two sources of business rules.
- Do not combine behavior changes with extraction. Record suspected bugs separately and decide them explicitly.

## Phase 0 — Characterize contracts

Before moving implementation, add focused characterization coverage for behavior that later phases must preserve.

### Work

- Record the allowed novel and chapter transitions for author and administrator actors.
- Cover ownership behavior for platform and author works and assets.
- Cover existing error status codes and response bodies for the affected HTTP routes.
- Cover published-version numbering, rollback-as-new-version, and the parent-novel visibility gate.
- Cover reading-progress conflict resolution, completion restart, and chapter-version restart.
- Cover account security invariants: enumeration resistance, token lifetime and single use, session revocation, rate limiting, and immediate status/role effects.

### Primary files

- `tests/rendered-html.test.mjs`
- New focused tests under `tests/` where a behavior can be exercised without the full runtime

### Exit gate

- The current behavior matrix is executable and passing before any extraction begins.

## Phase 1 — Creation lifecycle

Create one external creation-lifecycle module that owns novel and chapter behavior. Keep novel/chapter distinctions internal so cross-entity invariants remain local.

### Target shape

- Deep module: new D1-backed creation lifecycle implementation under `db/`.
- Adapters: existing author and administrator HTTP route modules.
- Internal behavior: ownership, allowed transitions, validation composition, parent-novel publication rule, version allocation, snapshots, and atomic writes.
- Existing normalization and content validation may remain in `lib/story.ts`, but callers must no longer assemble publication validation themselves.

### Migration sequence

1. Add module-interface tests for create, duplicate, save, submit, withdraw, reject, publish, offline, delete, and rollback.
2. Move version allocation and snapshot writes behind the module interface.
3. Move validation composition and transition guards behind the same interface.
4. Route author calls through the module while preserving ownership restrictions and response mapping.
5. Route administrator calls through the same module while preserving platform-work behavior.
6. Move version listing behind the module so four version routes no longer query schema directly.
7. Remove duplicated route implementation and any tests that only freeze its internals.

### Primary files

- `app/studio/api/novels/route.ts`
- `app/studio/api/chapters/route.ts`
- `app/studio/api/novels/versions/route.ts`
- `app/studio/api/chapters/versions/route.ts`
- `app/admin/api/novels/route.ts`
- `app/admin/api/chapters/route.ts`
- `app/admin/api/novels/versions/route.ts`
- `app/admin/api/chapters/versions/route.ts`
- `db/novels.ts`
- `db/chapters.ts`
- `lib/story.ts`
- `lib/assets.ts`

### Required tests

- Every allowed and rejected transition for both actors.
- Author cannot access another author's work.
- Platform work is manageable by administrators without acquiring an owner.
- Chapter publication requires a published parent novel.
- Taking a novel offline hides its chapters without changing chapter state.
- Publish and rollback allocate a new version and snapshot atomically.
- HTTP adapters preserve status codes and response shapes.

### Exit gate

- The creation lifecycle module is the only source of transition and version rules.
- HTTP routes contain only request parsing, actor resolution, module calls, and response mapping.

## Phase 2 — Asset lifecycle

Deepen the existing D1-backed asset implementation so upload, organization, generation, reference integrity, and deletion share one module interface.

### Target shape

- Deep module: evolve `db/assets.ts` into the asset lifecycle module.
- Adapters: author and administrator HTTP routes.
- Internal seams: D1 and local R2 behavior remain internal; remote media generators use production and mock adapters.
- Generated audio is an asset and enters the same lifecycle as uploaded media.

### Migration sequence

1. Add module-interface tests for listing, upload metadata, folder operations, generation, reference validation, and deletion.
2. Centralize platform-asset and author-asset authorization.
3. Centralize upload type, size, duration, naming, and folder rules.
4. Move whole-history reference discovery behind the module interface.
5. Make deletion idempotent: a missing stored object counts as removed, and the database record is deleted only after storage removal is confirmed.
6. Route TTS and SFX creation through the same lifecycle ownership rules.
7. Replace duplicated author/administrator route implementations and redundant pure-helper tests.

### Primary files

- `db/assets.ts`
- `lib/assets.ts`
- `lib/sfx.ts`
- `lib/tts.ts`
- `app/studio/api/assets/route.ts`
- `app/studio/api/assets/sfx/route.ts`
- `app/studio/api/assets/tts/route.ts`
- `app/admin/api/assets/route.ts`
- `app/admin/api/assets/sfx/route.ts`
- `app/admin/api/assets/tts/route.ts`

### Required tests

- Platform assets are selectable by authors but manageable only by administrators.
- Author assets are manageable only by their owner.
- Any reference from editable content, current published content, or historical versions blocks deletion.
- Repeated deletion and already-missing storage objects are safe.
- Storage failure produces a retryable failed state without losing the record.
- Generator failure, timeout, invalid media, and successful generation use the same module test surface.

### Exit gate

- Asset invariants and deletion compensation exist in one implementation.
- Six HTTP routes no longer duplicate ownership, generation, or storage orchestration.

## Phase 3 — Reading session

Move narrative state transitions and effect decisions out of React into an in-process reading-session module.

### Target shape

- Deep module: `lib/reader-session.ts` or an equivalently local page-specific module if only the reader uses it.
- React adapter: renders observable session state and forwards reader actions.
- Browser adapters: media playback, timers, local progress storage, and the owned remote progress transport.
- Preview uses the same session rules with a no-persistence progress adapter.

### Migration sequence

1. Characterize choice, phase, media, terminal-task, completion, and progress behavior through observable outcomes.
2. Introduce session state transitions and effect decisions without changing rendered behavior.
3. Replace real timers with an injected clock at the internal seam; use a virtual clock in tests.
4. Move local/cloud progress selection and version invalidation into the session implementation.
5. Make every media adapter completion path resolve, including failures, so narrative navigation cannot remain permanently blocked.
6. Convert `Reader` into a rendering adapter and remove superseded hook orchestration.
7. Remove pure-helper tests that are fully covered through the session interface; retain independently valuable content-rule tests.

### Primary files

- `app/story-studio.tsx`
- `app/fantasy-terminal.tsx`
- `app/api/account/progress/route.ts`
- `lib/story.ts`
- New reading-session module colocated in `lib/` or near the reader page

### Required tests

- Node and page navigation, including image/video phases and reduced motion.
- Choice locking, feedback completion, terminal-task ordering, and music decisions.
- Adapter failures always release the session to a reachable narrative state.
- Newer local/cloud progress wins; completion and version mismatch restart at the chapter beginning.
- Formal reading persists progress; preview never reads or writes it.
- React tests cover rendering and event forwarding rather than internal transition rules.

### Exit gate

- The reading-session interface is the test surface for narrative behavior.
- React no longer owns business ordering across story helpers, media, terminal callbacks, and progress persistence.

## Phase 4 — Account lifecycle

Deepen account behavior while keeping session validation and authorization as a separate high-leverage module.

### Target shape

- Deep module: new D1-backed account lifecycle implementation under `db/`.
- Session/authorization module: resolves current account state and role on every request.
- External ports: Turnstile and email delivery, each with production and mock adapters.
- Administrator capability adapter: accepts either an administrator account or the shared creator credential without pretending the credential is an account.

### Migration sequence

1. Add interface tests for registration, verification, login, password recovery/reset, profile changes, role changes, and status changes.
2. Introduce mock adapters for Turnstile and email; stop using local bypass as the only way to test success paths.
3. Move security-critical ordering and partial-failure behavior behind the lifecycle interface.
4. Move administrator account mutation into the same lifecycle rules.
5. Keep session lookup and authorization separate, but make them consume current account state and role.
6. Reduce HTTP routes to adapters and remove the fine-grained helper call sequence from callers.
7. Delete superseded helper tests after lifecycle behavior is covered.

### Primary files

- `app/api/auth/[...action]/route.ts`
- `app/admin/api/users/route.ts`
- `app/admin/api/session/route.ts`
- `lib/auth.ts`
- `lib/admin-auth.ts`
- New D1-backed account lifecycle module under `db/`

### Required tests

- Password recovery never reveals whether an email exists.
- Verification and reset tokens expire and cannot be reused.
- Password reset revokes all sessions for the account.
- Registration, login, and recovery enforce rate limits.
- Disabled or non-verified accounts cannot use an existing session.
- Role changes affect existing sessions on their next request.
- Administrator capability resolves from either supported authentication adapter.
- Turnstile and email failure, timeout, and retry behavior are observable through the lifecycle interface.

### Exit gate

- HTTP callers no longer know the ordering of password, token, rate-limit, verification, session, and delivery operations.
- Account lifecycle and session authorization each have one clear interface and one source of rules.

## Per-phase verification

Run after every phase:

```bash
pnpm lint
pnpm typecheck
pnpm test
```

Do not start the next phase until all commands pass and no duplicate business-rule implementation remains. If an unrelated existing failure appears, preserve the failure evidence and report it explicitly.

## Main risks

- **Behavior drift during extraction** — prevent with Phase 0 characterization and HTTP contract coverage.
- **A new pass-through module** — require the deletion test before keeping a module; remove it if deletion makes complexity vanish.
- **Hypothetical seams** — do not add a port for D1 unless a second real adapter appears.
- **Long-lived dual implementation** — complete one vertical phase before beginning the next.
- **Security regression** — keep account work last, preserve invariants, and exercise remote dependency failures with mock adapters.
- **Over-expanding shared code** — keep page-specific reader code local unless a second caller creates real leverage.

## Completion definition

The architecture program is complete when all four phases pass their exit gates, the existing HTTP and reader behavior remains compatible, each deep module is tested through its interface, and duplicated shallow implementation has been removed rather than retained behind another shallow module.
