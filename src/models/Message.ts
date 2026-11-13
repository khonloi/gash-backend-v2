import mongoose, { Schema, Model } from 'mongoose';
import { IMessage, IChatContextCard } from '../types/index.js';

const chatContextCardSchema = new Schema<IChatContextCard>(
  {
    cardType: {
      type: String,
      enum: {
        values: ['product', 'order'],
        message: '{VALUE} is not a valid context card type',
      },
      required: [true, 'Context card type is required'],
    },
    product: {
      type: Schema.Types.ObjectId,
      ref: 'Product',
    },
    order: {
      type: Schema.Types.ObjectId,
      ref: 'Order',
    },
    note: {
      type: String,
      trim: true,
      maxlength: [200, 'Context note cannot exceed 200 characters'],
    },
  },
  { _id: true }
);

const messageSchema = new Schema<IMessage>(
  {
    conversation: {
      type: Schema.Types.ObjectId,
      ref: 'Conversation',
      required: [true, 'Conversation reference is required'],
      index: true,
    },
    senderType: {
      type: String,
      enum: {
        values: ['customer', 'guest', 'ai', 'agent', 'system'],
        message: '{VALUE} is not a valid sender type',
      },
      required: [true, 'Sender type is required'],
      index: true,
    },
    senderUser: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      index: true,
    },
    content: {
      type: String,
      required: [true, 'Message content is required'],
      trim: true,
      minlength: [1, 'Message cannot be empty'],
      maxlength: [4000, 'Message cannot exceed 4000 characters'],
    },
    contextCards: {
      type: [chatContextCardSchema],
      default: [],
    },
    isRead: {
      type: Boolean,
      default: false,
      index: true,
    },
    readAt: {
      type: Date,
    },
    aiMetadata: {
      model: { type: String, trim: true },
      toolCalls: { type: [String], default: undefined },
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Indexes
messageSchema.index({ conversation: 1, createdAt: 1 });
messageSchema.index({ conversation: 1, createdAt: -1 });
messageSchema.index({ conversation: 1, isRead: 1, senderType: 1 });

export const Message: Model<IMessage> = mongoose.model<IMessage>(
  'Message',
  messageSchema
);
