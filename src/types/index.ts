import mongoose, { Document } from 'mongoose';

export type ProductStatus = 'draft' | 'active' | 'archived';

export interface IProductImage {
  url: string;
  altText?: string;
  isPrimary?: boolean;
  displayOrder?: number;
}

export interface IProductVariant {
  name: string;
  options: string[];
  sku?: string;
  priceModifier?: number;
  stock?: number;
}

export interface IProductDimensions {
  length?: number;
  width?: number;
  height?: number;
}

export interface IProductCategoryStats {
  category: string;
  numProducts: number;
  avgPrice: number;
  minPrice: number;
  maxPrice: number;
  totalQuantity: number;
  avgRating: number;
}

export interface IProduct extends Document {
  name: string;
  slug: string;
  description: string;
  shortDescription?: string;
  price: number;
  compareAtPrice?: number;
  costPrice?: number;
  sku: string;
  barcode?: string;
  quantity: number;
  lowStockThreshold: number;
  category: string;
  subcategory?: string;
  brand?: string;
  tags: string[];
  images: IProductImage[];
  variants: IProductVariant[];
  attributes: Map<string, string>;
  status: ProductStatus;
  isFeatured: boolean;
  weight?: number;
  dimensions?: IProductDimensions;
  ratingsAverage: number;
  ratingsQuantity: number;
  createdAt: Date;
  updatedAt: Date;
  // Virtual properties
  isLowStock?: boolean;
  isOnSale?: boolean;
  discountPercentage?: number;
}

export interface PaginatedResult<T> {
  data: T[];
  page: number;
  limit: number;
  totalPages: number;
  totalResults: number;
}

export interface QueryString {
  page?: string | number;
  limit?: string | number;
  sort?: string;
  fields?: string;
  keyword?: string;
  minPrice?: string | number;
  maxPrice?: string | number;
  [key: string]: unknown;
}

export * from './user.js';
export * from './order.js';

export interface ICartItem {
  _id?: mongoose.Types.ObjectId;
  product: mongoose.Types.ObjectId | IProduct;
  quantity: number;
  size?: string;
  color?: string;
  priceAtAdd: number;
}

export interface ICart extends Document {
  user: mongoose.Types.ObjectId;
  items: ICartItem[];
  createdAt: Date;
  updatedAt: Date;
  totalPrice?: number;
  totalItems?: number;
}
