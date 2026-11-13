import mongoose, { Schema, Model } from 'mongoose';
import { IConversation } from '../types/index.js';

const conversationSchema = new Schema<IConversation>(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      index: true,
    },
    guestId: {
      type: String,
      trim: true,
      index: true,
    },
    assignedAgent: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      index: true,
    },
    mode: {
      type: String,
      enum: {
        values: ['ai', 'support', 'seller'],
        message: '{VALUE} is not a valid conversation mode',
      },
      default: 'ai',
      index: true,
    },
    status: {
      type: String,
      enum: {
        values: ['bot_active', 'queued', 'assigned', 'resolved', 'closed'],
        message: '{VALUE} is not a valid conversation status',
      },
      default: 'bot_active',
      index: true,
    },
    subject: {
      type: String,
      trim: true,
      maxlength: [200, 'Subject cannot exceed 200 characters'],
    },
    lastMessageAt: {
      type: Date,
      default: Date.now,
      index: true,
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

// Compound indexes
conversationSchema.index({ user: 1, updatedAt: -1 });
conversationSchema.index({ guestId: 1, updatedAt: -1 });
conversationSchema.index({ status: 1, mode: 1, lastMessageAt: -1 });
conversationSchema.index({ assignedAgent: 1, status: 1, lastMessageAt: -1 });

// Ensure at least one of user or guestId is present
conversationSchema.pre('validate', function () {
  if (!this.user && !this.guestId) {
    this.invalidate('user', 'Conversation must belong to a user or a guest ID');
  }
});

export const Conversation: Model<IConversation> = mongoose.model<IConversation>(
  'Conversation',
  conversationSchema
);
