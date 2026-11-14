---
name: quality-verification
description: >-
  Project-specific testing, linting, static type checking, build verification, and quality gates for
  gash-backend-v2. Use this skill whenever running Jest tests, linting with ESLint, type-checking
  with TypeScript, editing Express/Mongoose/Socket.IO modules, or verifying changes before
  completion in gash-backend-v2.
---

# GASH Backend v2: Testing, Linting & Quality Verification

Use this workflow to verify code changes, author integration tests, and enforce backend quality gates in `d:\Project\gash-backend-v2`.

## Environment & Tooling

Run verification commands with `pnpm` from `d:\Project\gash-backend-v2`:

```powershell
# 1. Type-check
pnpm run typecheck

# 2. Lint with ESLint
pnpm run lint

# 3. Run full Jest unit & integration test suite
pnpm test

# 4. Verify production TypeScript build
pnpm run build
```

## Targeted Test Execution

| Subsystem | Test File(s) | Command |
| :--- | :--- | :--- |
| App Health & Middleware | `tests/app.test.ts`, `tests/middlewares.test.ts` | `pnpm test -- tests/app.test.ts tests/middlewares.test.ts` |
| Auth & Users | `tests/auth.test.ts`, `tests/user.test.ts` | `pnpm test -- tests/auth.test.ts tests/user.test.ts` |
| Products & Inventory | `tests/product.test.ts`, `tests/inventoryService.test.ts` | `pnpm test -- tests/product.test.ts tests/inventoryService.test.ts` |
| Cart & Orders | `tests/cart.test.ts`, `tests/order.test.ts`, `tests/orderStateMachine.test.ts` | `pnpm test -- tests/cart.test.ts tests/order.test.ts tests/orderStateMachine.test.ts` |
| Hybrid AI/Support Chat & Socket.IO | `tests/chat.test.ts`, `tests/socket.test.ts` | `pnpm test -- tests/chat.test.ts tests/socket.test.ts` |
| Services & Utilities | `tests/services.test.ts`, `tests/objectId.test.ts`, `tests/utils.test.ts` | `pnpm test -- tests/services.test.ts tests/objectId.test.ts tests/utils.test.ts` |

## Architectural & Testing Invariants

1. **ESM Module Specifiers**:
   - `package.json` sets `"type": "module"`. Local relative imports in TypeScript source files must preserve `.js` extensions (e.g., `import { env } from '../config/env.js';`).
2. **Offline Test Isolation**:
   - Integration tests use `mongodb-memory-server` rather than connecting to a live local or remote MongoDB instance.
3. **Real-Time Support Chat Lifecycle (`src/services/chatService.ts`, `src/controllers/chatController.ts`, `src/socket/`)**:
   - Closed conversations (`status: 'closed'`) must be excluded from all staff/admin conversation listings (even when `status` filter is omitted) and cannot be claimed or messaged by staff.
   - Staff cannot send messages (`sendAgentMessage`) unless `conversation.status` is `'queued'` or `'assigned'`.
   - `user` (`firstName lastName email avatar role`) and `assignedAgent` (`firstName lastName email avatar role`) must be populated before returning or emitting conversations.
   - Socket.IO emissions via `emitToConversationParticipants` must target both `conversation:<id>` and `user:<userId>` / `guest:<guestId>`, plus `support:agents` for agent-facing updates.
   - Socket connections auto-join `user:<userId>` or `guest:<guestId>` and active conversation rooms in `src/socket/chatHandler.ts`.

## Pre-Completion Verification Checklist

Before declaring any change complete in `gash-backend-v2`:
1. `pnpm run typecheck` passes with zero errors.
2. `pnpm run lint` passes with zero errors.
3. `pnpm test` passes 100% of test suites and test cases.
4. `pnpm run build` compiles cleanly when build artifacts or tsconfig paths are affected.

