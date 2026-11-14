---
name: hybrid-chat-and-socket-architecture
description: >-
  Architectural guide and lifecycle invariants for the hybrid AI shopping assistant and live human
  support Socket.IO system in gash-backend-v2. Use when modifying conversations, messages, Gemini AI
  tool calling, human handoff, ticket assignment, status transitions, or WebSocket rooms and events.
---

# Hybrid Chat & Socket.IO Architecture (`gash-backend-v2`)

Use this reference when modifying or debugging the hybrid AI/human support system across REST endpoints, Mongoose models, and Socket.IO rooms.

## Core Modules

- Models: `src/models/Conversation.ts`, `src/models/Message.ts`
- Services: `src/services/chatService.ts`, `src/services/aiChatService.ts`
- Controller & Validation: `src/controllers/chatController.ts`, `src/validations/chatValidation.ts`
- Socket.IO: `src/socket/index.ts`, `src/socket/socketAuth.ts`, `src/socket/chatHandler.ts`
- Shared Constants: `src/config/constants.ts`

## Conversation & Message Schema Rules

- `Conversation.mode`: `'ai' | 'support' | 'seller'` (default `'ai'`).
- `Conversation.status`: `'bot_active' | 'queued' | 'assigned' | 'resolved' | 'closed'` (default `'bot_active'`).
- Every conversation must belong to either `user` (ObjectId ref `'User'`) or `guestId` (validated in `conversationSchema.pre('validate')`).
- `Message.senderType`: `'customer' | 'guest' | 'ai' | 'agent' | 'system'`.
- Context cards (`contextCards`): support `'product'` and `'order'` references (`MAX_CONTEXT_CARDS_PER_MESSAGE = 5`), verified by `ChatService.resolveContextCards`.

## Status Transitions & Lifecycle Invariants

1. **Permitted Transitions (`VALID_CONVERSATION_STATUS_TRANSITIONS` in `src/config/constants.ts`)**:
   - `bot_active` -> `['queued', 'closed', 'resolved']`
   - `queued` -> `['assigned', 'closed', 'resolved', 'bot_active']`
   - `assigned` -> `['resolved', 'closed', 'queued']`
   - `resolved` -> `['queued', 'closed', 'bot_active']`
   - `closed` -> `['queued', 'bot_active']`
2. **Staff Interaction Gate**:
   - In `ChatService.sendMessage`: staff (`admin` / `seller`) cannot send messages while `conversation.status === 'bot_active'`. Customers must escalate first (`requestHandoff` -> `queued`).
   - In `ChatService.assignConversation`: `bot_active` and `closed` conversations cannot be claimed.
   - In `ChatService.updateConversationStatus`: staff cannot change status of a `bot_active` conversation before human support is requested.
3. **Closed Conversation Visibility**:
   - In `ChatService.getConversations`: when `actor.role` is `'admin'` or `'seller'` and `query.status` is omitted (`All` view), filter out closed conversations (`filter.status = { $ne: 'closed' }`).
4. **Participant Population**:
   - Always populate `'user'` and `'assignedAgent'` using `CHAT_USER_PROJECTION` (`'_id firstName lastName avatar role email'`) before returning conversations from service methods or emitting them via Socket.IO.

## Socket.IO Rooms & Real-Time Delivery

1. **Auto-Joined Rooms (`registerChatHandlers` in `src/socket/chatHandler.ts`)**:
   - Staff (`admin` / `seller`) auto-join `'support:agents'`.
   - Authenticated customers auto-join `user:<userId>` and all their existing `conversation:<id>` rooms.
   - Guests auto-join `guest:<guestId>` and all their existing `conversation:<id>` rooms.
2. **Participant Broadcast Helper (`emitToConversationParticipants` in `src/socket/index.ts`)**:
   - Always emit conversation/message events to `conversation:<id>`, `support:agents`, `user:<userId>` (when present), and `guest:<guestId>` (when present) so updates arrive even if a client has not yet explicitly emitted `'chat:join'`.
3. **AI Shopping Assistant (`src/services/aiChatService.ts`)**:
   - Initializes `GoogleGenAI` when `env.GEMINI_API_KEY` is configured and `env.NODE_ENV !== 'test'`.
   - Provides tool helpers such as `toolSearchProducts` and `toolGetProductStock` returning grounded summaries and `IChatContextCard[]` attachments.

## Verification

Run `pnpm test -- tests/chat.test.ts tests/socket.test.ts` and `pnpm run typecheck` after any change.

