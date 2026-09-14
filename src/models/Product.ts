import mongoose, { Schema, Model } from 'mongoose';
import { IProduct, IProductImage, IProductVariant } from '../types/index.js';
import { slugify } from '../utils/slugify.js';

const productImageSchema = new Schema<IProductImage>(
  {
    url: {
      type: String,
      required: [true, 'Image URL is required'],
      trim: true,
    },
    altText: {
      type: String,
      trim: true,
      default: '',
    },
    isPrimary: {
      type: Boolean,
      default: false,
    },
    displayOrder: {
      type: Number,
      default: 0,
    },
  },
  { _id: false }
);

const productVariantSchema = new Schema<IProductVariant>(
  {
    name: {
      type: String,
      required: [true, 'Variant name is required (e.g. Size, Color)'],
      trim: true,
    },
    options: {
      type: [String],
      required: [true, 'Variant options are required'],
      default: [],
    },
    sku: {
      type: String,
      trim: true,
      uppercase: true,
    },
    priceModifier: {
      type: Number,
      default: 0,
    },
    stock: {
      type: Number,
      default: 0,
      min: [0, 'Variant stock cannot be negative'],
    },
  },
  { _id: false }
);

const productSchema = new Schema<IProduct>(
  {
    name: {
      type: String,
      required: [true, 'Product name is required'],
      trim: true,
      minlength: [3, 'Product name must be at least 3 characters'],
      maxlength: [200, 'Product name cannot exceed 200 characters'],
    },
    slug: {
      type: String,
      unique: true,
      lowercase: true,
      trim: true,
    },
    description: {
      type: String,
      required: [true, 'Product description is required'],
      trim: true,
      maxlength: [5000, 'Product description cannot exceed 5000 characters'],
    },
    shortDescription: {
      type: String,
      trim: true,
      maxlength: [500, 'Short description cannot exceed 500 characters'],
    },
    price: {
      type: Number,
      required: [true, 'Product price is required'],
      min: [0, 'Price must be greater than or equal to 0'],
    },
    compareAtPrice: {
      type: Number,
      min: [0, 'Compare at price must be greater than or equal to 0'],
      validate: {
        validator: function (this: IProduct, val: number): boolean {
          // Only validate if compareAtPrice is provided
          return !val || val > this.price;
        },
        message:
          'Compare at price ({VALUE}) must be higher than the regular price',
      },
    },
    costPrice: {
      type: Number,
      min: [0, 'Cost price must be greater than or equal to 0'],
    },
    sku: {
      type: String,
      required: [true, 'SKU is required'],
      unique: true,
      uppercase: true,
      trim: true,
    },
    barcode: {
      type: String,
      trim: true,
    },
    quantity: {
      type: Number,
      required: [true, 'Product quantity is required'],
      min: [0, 'Quantity cannot be negative'],
      default: 0,
    },
    lowStockThreshold: {
      type: Number,
      min: [0, 'Low stock threshold cannot be negative'],
      default: 5,
    },
    category: {
      type: String,
      required: [true, 'Product category is required'],
      trim: true,
      index: true,
    },
    subcategory: {
      type: String,
      trim: true,
    },
    brand: {
      type: String,
      trim: true,
      index: true,
    },
    tags: {
      type: [String],
      default: [],
      index: true,
    },
    images: {
      type: [productImageSchema],
      default: [],
    },
    variants: {
      type: [productVariantSchema],
      default: [],
    },
    attributes: {
      type: Map,
      of: String,
      default: {},
    },
    status: {
      type: String,
      enum: {
        values: ['draft', 'active', 'archived'],
        message: '{VALUE} is not a valid status',
      },
      default: 'draft',
      index: true,
    },
    isFeatured: {
      type: Boolean,
      default: false,
      index: true,
    },
    weight: {
      type: Number,
      min: [0, 'Weight cannot be negative'],
    },
    dimensions: {
      length: { type: Number, min: 0 },
      width: { type: Number, min: 0 },
      height: { type: Number, min: 0 },
    },
    ratingsAverage: {
      type: Number,
      default: 4.5,
      min: [1, 'Rating must be at least 1.0'],
      max: [5, 'Rating must be at most 5.0'],
      set: (val: number): number => Math.round(val * 10) / 10,
    },
    ratingsQuantity: {
      type: Number,
      default: 0,
      min: [0, 'Ratings quantity cannot be negative'],
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Compound indexes
productSchema.index({ category: 1, price: 1 });
productSchema.index({ status: 1, isFeatured: 1 });
productSchema.index({ name: 'text', description: 'text', tags: 'text' });

// Virtuals
productSchema.virtual('isLowStock').get(function (this: IProduct) {
  return this.quantity <= this.lowStockThreshold;
});

productSchema.virtual('isOnSale').get(function (this: IProduct) {
  return Boolean(this.compareAtPrice && this.compareAtPrice > this.price);
});

productSchema.virtual('discountPercentage').get(function (this: IProduct) {
  if (this.compareAtPrice && this.compareAtPrice > this.price) {
    return Math.round(
      ((this.compareAtPrice - this.price) / this.compareAtPrice) * 100
    );
  }
  return 0;
});

// Auto-generate unique slug from name
productSchema.pre('validate', function () {
  if (this.isModified('name') || !this.slug) {
    this.slug = slugify(this.name);
  }
});

export const Product: Model<IProduct> = mongoose.model<IProduct>(
  'Product',
  productSchema
);
