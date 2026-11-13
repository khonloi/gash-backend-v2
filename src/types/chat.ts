import mongoose, { Document } from 'mongoose';
import { IUser } from './user.js';
import { IProduct } from './index.js';
import { IOrder } from './order.js';

export type ConversationMode = 'ai' | 'support' | 'seller';

export type ConversationStatus =
  'bot_active' | 'queued' | 'assigned' | 'resolved' | 'closed';

export type MessageSenderType =
  'customer' | 'guest' | 'ai' | 'agent' | 'system';

export type ContextCardType = 'product' | 'order';

export interface IChatContextCard {
  cardType: ContextCardType;
  product?: mongoose.Types.ObjectId | IProduct;
  order?: mongoose.Types.ObjectId | IOrder;
  note?: string;
}

export interface IConversation extends Document {
  user?: mongoose.Types.ObjectId | IUser;
  guestId?: string;
  assignedAgent?: mongoose.Types.ObjectId | IUser;
  mode: ConversationMode;
  status: ConversationStatus;
  subject?: string;
  lastMessageAt?: Date;
  lastMessagePreview?: string;
  unreadCountCustomer: number;
  unreadCountAgent: number;
  handoffReason?: string;
  closedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface IMessageAiMetadata {
  model?: string;
  toolCalls?: string[];
}

export interface IMessage extends Document {
  conversation: mongoose.Types.ObjectId | IConversation;
  senderType: MessageSenderType;
  senderUser?: mongoose.Types.ObjectId | IUser;
  content: string;
  contextCards: IChatContextCard[];
  isRead: boolean;
  readAt?: Date;
  aiMetadata?: IMessageAiMetadata;
  createdAt: Date;
  updatedAt: Date;
}

export interface ChatActor {
  userId?: string;
  guestId?: string;
  role?: 'customer' | 'seller' | 'admin' | 'guest';
}
