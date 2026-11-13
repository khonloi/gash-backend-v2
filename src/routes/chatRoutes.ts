import { Router } from 'express';
import {
  createConversation,
  getConversations,
  getConversation,
  getMessages,
  sendMessage,
  requestHandoff,
  assignConversation,
  updateConversationStatus,
  markConversationRead,
  mergeGuestChat,
} from '../controllers/chatController.js';
import { validate } from '../middlewares/validate.js';
import { protect, optionalAuth, restrictTo } from '../middlewares/auth.js';
import {
  createConversationSchema,
  sendMessageSchema,
  handoffSchema,
  updateConversationStatusSchema,
  conversationQuerySchema,
  mergeChatSchema,
} from '../validations/chatValidation.js';
import { idParamSchema } from '../validations/commonValidation.js';

const router: Router = Router();

// Guest merge endpoint (must be authenticated)
router.post(
  '/merge',
  protect,
  validate(mergeChatSchema, 'body'),
  mergeGuestChat
);

// Conversation collection endpoints
router
  .route('/conversations')
  .post(
    optionalAuth,
    validate(createConversationSchema, 'body'),
    createConversation
  )
  .get(
    optionalAuth,
    validate(conversationQuerySchema, 'query'),
    getConversations
  );

// Single conversation endpoints
router
  .route('/conversations/:id')
  .get(optionalAuth, validate(idParamSchema, 'params'), getConversation);

router
  .route('/conversations/:id/messages')
  .get(optionalAuth, validate(idParamSchema, 'params'), getMessages)
  .post(
    optionalAuth,
    validate(idParamSchema, 'params'),
    validate(sendMessageSchema, 'body'),
    sendMessage
  );

router.post(
  '/conversations/:id/handoff',
  optionalAuth,
  validate(idParamSchema, 'params'),
  validate(handoffSchema, 'body'),
  requestHandoff
);

router.patch(
  '/conversations/:id/assign',
  protect,
  restrictTo('admin', 'seller'),
  validate(idParamSchema, 'params'),
  assignConversation
);

router.patch(
  '/conversations/:id/status',
  optionalAuth,
  validate(idParamSchema, 'params'),
  validate(updateConversationStatusSchema, 'body'),
  updateConversationStatus
);

router.patch(
  '/conversations/:id/read',
  optionalAuth,
  validate(idParamSchema, 'params'),
  markConversationRead
);

export default router;
