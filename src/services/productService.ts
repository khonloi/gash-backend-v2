import mongoose from 'mongoose';
import { Product } from '../models/Product.js';
import { IProduct, PaginatedResult, QueryString } from '../types/index.js';
import { AppError } from '../utils/AppError.js';
import { APIFeatures } from '../utils/apiFeatures.js';
import { slugify } from '../utils/slugify.js';
import {
  CreateProductInput,
  UpdateProductInput,
} from '../validations/productValidation.js';

export class ProductService {
  /**
   * Create a new product with unique SKU check
   */
  async createProduct(data: CreateProductInput): Promise<IProduct> {
    const existingProduct = await Product.findOne({
      sku: data.sku.toUpperCase(),
    });
    if (existingProduct) {
      throw new AppError(
        `A product with SKU "${data.sku}" already exists`,
        400
      );
    }

    const product = await Product.create({
      ...data,
      sku: data.sku.toUpperCase(),
    });

    return product;
  }

  /**
   * Get all products with filtering, search, sorting, field limiting, and pagination
   */
  async getAllProducts(
    queryString: QueryString
  ): Promise<PaginatedResult<IProduct>> {
    // 1) Count total documents matching filters
    const countFeatures = new APIFeatures(Product.find(), queryString)
      .filter()
      .search();
    const totalResults = await countFeatures.mongooseQuery.countDocuments();

    // 2) Execute query with sorting, pagination, and projection
    const features = new APIFeatures(Product.find(), queryString)
      .filter()
      .search()
      .sort()
      .limitFields()
      .paginate(totalResults);

    const data = await features.mongooseQuery;

    return {
      data,
      ...features.pagination,
    };
  }

  /**
   * Get product by ID
   */
  async getProductById(id: string): Promise<IProduct> {
    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new AppError(`Invalid product ID format: "${id}"`, 400);
    }

    const product = await Product.findById(id);
    if (!product) {
      throw new AppError(`No product found with ID "${id}"`, 404);
    }

    return product;
  }

  /**
   * Get product by URL-friendly slug
   */
  async getProductBySlug(slug: string): Promise<IProduct> {
    const product = await Product.findOne({ slug });
    if (!product) {
      throw new AppError(`No product found with slug "${slug}"`, 404);
    }

    return product;
  }

  /**
   * Update product by ID
   */
  async updateProduct(
    id: string,
    updateData: UpdateProductInput
  ): Promise<IProduct> {
    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new AppError(`Invalid product ID format: "${id}"`, 400);
    }

    // Check SKU collision if SKU is being updated
    if (updateData.sku) {
      const skuUpper = updateData.sku.toUpperCase();
      const existingSku = await Product.findOne({
        sku: skuUpper,
        _id: { $ne: id },
      });
      if (existingSku) {
        throw new AppError(
          `A product with SKU "${updateData.sku}" already exists`,
          400
        );
      }
      updateData.sku = skuUpper;
    }

    // Update slug if name changed and slug not explicitly provided
    const payload: Record<string, unknown> = { ...updateData };
    if (updateData.name) {
      payload.slug = slugify(updateData.name);
    }

    const product = await Product.findByIdAndUpdate(id, payload, {
      returnDocument: 'after',
      runValidators: true,
    });

    if (!product) {
      throw new AppError(`No product found with ID "${id}"`, 404);
    }

    return product;
  }

  /**
   * Hard delete product by ID
   */
  async deleteProduct(id: string): Promise<void> {
    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new AppError(`Invalid product ID format: "${id}"`, 400);
    }

    const product = await Product.findByIdAndDelete(id);
    if (!product) {
      throw new AppError(`No product found with ID "${id}"`, 404);
    }
  }

  /**
   * Atomic stock update (set, increment, decrement)
   */
  async updateProductStock(
    id: string,
    quantity: number,
    operation: 'increment' | 'decrement' | 'set' = 'set'
  ): Promise<IProduct> {
    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new AppError(`Invalid product ID format: "${id}"`, 400);
    }

    if (operation === 'set') {
      if (quantity < 0) {
        throw new AppError('Stock quantity cannot be negative', 400);
      }
      const product = await Product.findByIdAndUpdate(
        id,
        { $set: { quantity } },
        { returnDocument: 'after', runValidators: true }
      );
      if (!product) {
        throw new AppError(`No product found with ID "${id}"`, 404);
      }
      return product;
    }

    if (operation === 'increment') {
      if (quantity <= 0) {
        throw new AppError('Increment amount must be greater than 0', 400);
      }
      const product = await Product.findByIdAndUpdate(
        id,
        { $inc: { quantity } },
        { returnDocument: 'after', runValidators: true }
      );
      if (!product) {
        throw new AppError(`No product found with ID "${id}"`, 404);
      }
      return product;
    }

    if (operation === 'decrement') {
      if (quantity <= 0) {
        throw new AppError('Decrement amount must be greater than 0', 400);
      }

      // Atomic decrement preventing negative stock balance
      const product = await Product.findOneAndUpdate(
        { _id: id, quantity: { $gte: quantity } },
        { $inc: { quantity: -quantity } },
        { returnDocument: 'after', runValidators: true }
      );

      if (!product) {
        const existing = await Product.findById(id);
        if (!existing) {
          throw new AppError(`No product found with ID "${id}"`, 404);
        }
        throw new AppError(
          `Insufficient stock. Available: ${existing.quantity}, requested: ${quantity}`,
          400
        );
      }

      return product;
    }

    throw new AppError(`Invalid stock operation: "${operation}"`, 400);
  }

  /**
   * Aggregation pipeline for category statistics
   */
  async getProductStats(): Promise<any[]> {
    const stats = await Product.aggregate([
      {
        $group: {
          _id: '$category',
          numProducts: { $sum: 1 },
          avgPrice: { $avg: '$price' },
          minPrice: { $min: '$price' },
          maxPrice: { $max: '$price' },
          totalQuantity: { $sum: '$quantity' },
          avgRating: { $avg: '$ratingsAverage' },
        },
      },
      {
        $project: {
          category: '$_id',
          _id: 0,
          numProducts: 1,
          avgPrice: { $round: ['$avgPrice', 2] },
          minPrice: 1,
          maxPrice: 1,
          totalQuantity: 1,
          avgRating: { $round: ['$avgRating', 1] },
        },
      },
      { $sort: { numProducts: -1 } },
    ]);

    return stats;
  }

  /**
   * Retrieve active, featured products
   */
  async getFeaturedProducts(limit = 10): Promise<IProduct[]> {
    return Product.find({ isFeatured: true, status: 'active' })
      .sort('-ratingsAverage')
      .limit(limit);
  }
}

export const productService = new ProductService();
