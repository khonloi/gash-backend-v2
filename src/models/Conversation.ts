import mongoose, { Schema, Model } from 'mongoose';
import { IConversation } from '../types/index.js';

const conversationSchema = new Schema<IConversation>(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: 'User',
    },
    guestId: {
      type: String,
      trim: true,
      minlength: [8, 'Guest ID must be at least 8 characters'],
      maxlength: [128, 'Guest ID cannot exceed 128 characters'],
    },
    assignedAgent: {
      type: Schema.Types.ObjectId,
      ref: 'User',
    },
    mode: {
      type: String,
      enum: {
        values: ['ai', 'support', 'seller'],
        message: '{VALUE} is not a valid conversation mode',
      },
      default: 'ai',
    },
    status: {
      type: String,
      enum: {
        values: ['bot_active', 'queued', 'assigned', 'resolved', 'closed'],
        message: '{VALUE} is not a valid conversation status',
      },
      default: 'bot_active',
    },
    subject: {
      type: String,
      trim: true,
      maxlength: [200, 'Subject cannot exceed 200 characters'],
    },
    lastMessageAt: {
      type: Date,
      default: Date.now,
    },
    lastMessagePreview: {
      type: String,
      trim: true,
      maxlength: [300, 'Message preview cannot exceed 300 characters'],
    },
    unreadCountCustomer: {
      type: Number,
      default: 0,
      min: [0, 'Unread count cannot be negative'],
    },
    unreadCountAgent: {
      type: Number,
      default: 0,
      min: [0, 'Unread count cannot be negative'],
    },
    handoffReason: {
      type: String,
      trim: true,
      maxlength: [500, 'Handoff reason cannot exceed 500 characters'],
    },
    closedAt: {
      type: Date,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Compound indexes aligned with query + sort patterns
conversationSchema.index({ user: 1, lastMessageAt: -1 });
conversationSchema.index({ guestId: 1, lastMessageAt: -1 });
conversationSchema.index({ status: 1, mode: 1, lastMessageAt: -1 });
conversationSchema.index({ assignedAgent: 1, status: 1, lastMessageAt: -1 });

// Partial unique indexes preventing concurrent duplicate open conversations per actor+mode
conversationSchema.index(
  { user: 1, mode: 1 },
  {
    unique: true,
    partialFilterExpression: {
      user: { $exists: true },
      status: { $in: ['bot_active', 'queued', 'assigned'] },
    },
  }
);
conversationSchema.index(
  { guestId: 1, mode: 1 },
  {
    unique: true,
    partialFilterExpression: {
      guestId: { $exists: true },
      status: { $in: ['bot_active', 'queued', 'assigned'] },
    },
  }
);

// Ensure XOR ownership: exactly one of user or guestId is present
conversationSchema.pre('validate', function () {
  const hasUser = Boolean(this.user);
  const hasGuest = Boolean(this.guestId);
  if (!hasUser && !hasGuest) {
    this.invalidate('user', 'Conversation must belong to a user or a guest ID');
  } else if (hasUser && hasGuest) {
    this.invalidate(
      'guestId',
      'Conversation cannot belong to both a user and a guest ID'
    );
  }
});

export const Conversation: Model<IConversation> = mongoose.model<IConversation>(
  'Conversation',
  conversationSchema
);
