import { Product } from '../models/Product.js';
import { Cart } from '../models/Cart.js';
import { Order } from '../models/Order.js';
import {
  IProduct,
  IProductCategoryStats,
  PaginatedResult,
  QueryString,
  UserRole,
} from '../types/index.js';
import { AppError } from '../utils/AppError.js';
import { paginateQuery } from '../utils/apiFeatures.js';
import { slugify } from '../utils/slugify.js';
import {
  CreateProductInput,
  UpdateProductInput,
} from '../validations/productValidation.js';
import { assertObjectId } from '../utils/objectId.js';
import { resolveOwnerId } from '../utils/resolveOwnerId.js';
import { normalizeAndValidateVariants } from '../utils/productVariants.js';

export interface ProductActor {
  id: string;
  role: UserRole;
}

export class ProductService {
  private assertProductModifyAccess(
    product: IProduct,
    actor?: ProductActor
  ): void {
    if (!actor || actor.role === 'admin') {
      return;
    }
    const ownerId = resolveOwnerId(product.seller);
    if (!ownerId || ownerId !== actor.id) {
      throw new AppError(
        'You do not have permission to modify this product',
        403
      );
    }
  }

  private assertProductReadAccess(
    product: IProduct,
    actor?: ProductActor
  ): void {
    if (product.status === 'active') return;
    if (actor?.role === 'admin') return;
    if (
      actor?.role === 'seller' &&
      resolveOwnerId(product.seller) === actor.id
    ) {
      return;
    }
    throw new AppError(`No product found`, 404);
  }
  /**
   * Generates a collision-free URL slug using a single prefix regex query.
   */
  async generateUniqueSlug(name: string, excludeId?: string): Promise<string> {
    const baseSlug = slugify(name);
    if (!baseSlug) {
      throw new AppError(
        'Product name must contain alphanumeric characters to generate a URL slug',
        400
      );
    }

    const escaped = baseSlug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const query: Record<string, unknown> = {
      slug: new RegExp(`^${escaped}(?:-\\d+)?$`),
    };
    if (excludeId) {
      query._id = { $ne: excludeId };
    }

    const existingDocs = await Product.find(query).select('slug').lean();
    if (existingDocs.length === 0) {
      return baseSlug;
    }

    const usedSlugs = new Set(existingDocs.map((d) => d.slug));
    if (!usedSlugs.has(baseSlug)) {
      return baseSlug;
    }

    let counter = 1;
    while (usedSlugs.has(`${baseSlug}-${counter}`)) {
      counter++;
    }
    return `${baseSlug}-${counter}`;
  }

  /**
   * Create a new product with unique SKU check, variant validation, and price consistency
   */
  async createProduct(
    data: CreateProductInput,
    sellerId?: string
  ): Promise<IProduct> {
    if (
      data.compareAtPrice !== undefined &&
      data.compareAtPrice <= data.price
    ) {
      throw new AppError(
        `Compare at price (${data.compareAtPrice}) must be higher than the regular price`,
        400
      );
    }

    const skuUpper = data.sku.toUpperCase();
    const existingProduct = await Product.findOne({ sku: skuUpper })
      .select('_id')
      .lean();
    if (existingProduct) {
      throw new AppError(
        `A product with SKU "${data.sku}" already exists`,
        400
      );
    }

    const payload: Record<string, unknown> = {
      ...data,
      sku: skuUpper,
      slug: await this.generateUniqueSlug(data.name),
      ...(sellerId ? { seller: sellerId } : {}),
    };

    if (data.variants && data.variants.length > 0) {
      const { normalizedVariants, totalStock } = normalizeAndValidateVariants(
        data.price,
        data.variants
      );
      payload.variants = normalizedVariants;
      payload.quantity = totalStock;
    }

    return Product.create(payload);
  }

  /**
   * Get all products with filtering, search, sorting, field limiting, and pagination
   */
  async getAllProducts(
    queryString: QueryString,
    actor?: ProductActor
  ): Promise<PaginatedResult<IProduct>> {
    const isStaff = actor?.role === 'admin' || actor?.role === 'seller';
    const lockedFilter = isStaff ? undefined : ({ status: 'active' } as const);

    return paginateQuery(
      () =>
        lockedFilter ? Product.find({ status: 'active' }) : Product.find(),
      queryString,
      {
        search: true,
        ...(lockedFilter ? { lockedFilter } : {}),
        allowedFilterFields: [
          'category',
          'subcategory',
          'brand',
          'status',
          'isFeatured',
          'tags',
          'price',
          'ratingsAverage',
          'ratingsQuantity',
        ],
        allowedSortFields: [
          'createdAt',
          'updatedAt',
          'price',
          'name',
          'ratingsAverage',
          'ratingsQuantity',
          'quantity',
        ],
        excludedSelectFields: ['costPrice'],
      }
    );
  }

  /**
   * Get product by ID
   */
  async getProductById(id: string, actor?: ProductActor): Promise<IProduct> {
    assertObjectId(id, 'product ID');

    const product = await Product.findById(id);
    if (!product) {
      throw new AppError(`No product found with ID "${id}"`, 404);
    }
    this.assertProductReadAccess(product, actor);

    return product;
  }

  /**
   * Get product by URL-friendly slug
   */
  async getProductBySlug(
    slug: string,
    actor?: ProductActor
  ): Promise<IProduct> {
    const product = await Product.findOne({ slug: slug.toLowerCase() });
    if (!product) {
      throw new AppError(`No product found with slug "${slug}"`, 404);
    }
    this.assertProductReadAccess(product, actor);

    return product;
  }

  /**
   * Update product by ID
   */
  async updateProduct(
    id: string,
    updateData: UpdateProductInput,
    actor?: ProductActor
  ): Promise<IProduct> {
    assertObjectId(id, 'product ID');

    const existing = await Product.findById(id);
    if (!existing) {
      throw new AppError(`No product found with ID "${id}"`, 404);
    }
    this.assertProductModifyAccess(existing, actor);

    const payload: Record<string, unknown> = { ...updateData };

    // Cross-field compareAtPrice validation against merged document values
    const effectivePrice = updateData.price ?? existing.price;
    const effectiveCompareAt =
      updateData.compareAtPrice !== undefined
        ? updateData.compareAtPrice
        : existing.compareAtPrice;
    if (
      effectiveCompareAt !== undefined &&
      effectiveCompareAt !== null &&
      effectiveCompareAt <= effectivePrice
    ) {
      throw new AppError(
        `Compare at price (${effectiveCompareAt}) must be higher than the regular price`,
        400
      );
    }

    // Revalidate/sync variants & total quantity when variants or base price change
    if (updateData.variants !== undefined) {
      if (updateData.variants.length > 0) {
        const { normalizedVariants, totalStock } = normalizeAndValidateVariants(
          effectivePrice,
          updateData.variants
        );
        payload.variants = normalizedVariants;
        payload.quantity = totalStock;
      }
    } else if (
      updateData.price !== undefined &&
      existing.variants &&
      existing.variants.length > 0
    ) {
      normalizeAndValidateVariants(effectivePrice, existing.variants);
    }

    // Check SKU collision if SKU is being updated
    if (updateData.sku) {
      const skuUpper = updateData.sku.toUpperCase();
      const existingSku = await Product.findOne({
        sku: skuUpper,
        _id: { $ne: id },
      })
        .select('_id')
        .lean();
      if (existingSku) {
        throw new AppError(
          `A product with SKU "${updateData.sku}" already exists`,
          400
        );
      }
      payload.sku = skuUpper;
    }

    // Update slug only when name actually changed
    if (updateData.name && updateData.name !== existing.name) {
      payload.slug = await this.generateUniqueSlug(updateData.name, id);
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
   * Hard delete product by ID (blocked if referenced by active orders; cleans up carts)
   */
  async deleteProduct(id: string): Promise<void> {
    assertObjectId(id, 'product ID');

    const hasActiveOrder = await Order.exists({
      'items.product': id,
      status: { $in: ['pending', 'confirmed', 'processing', 'shipped'] },
    });
    if (hasActiveOrder) {
      throw new AppError(
        'Cannot delete product referenced by active orders; archive it instead',
        400
      );
    }

    const product = await Product.findByIdAndDelete(id);
    if (!product) {
      throw new AppError(`No product found with ID "${id}"`, 404);
    }

    await Cart.updateMany({}, { $pull: { items: { product: id } } });
  }

  /**
   * Atomic stock update (set, increment, decrement)
   */
  async updateProductStock(
    id: string,
    quantity: number,
    operation: 'increment' | 'decrement' | 'set' = 'set',
    actor?: ProductActor
  ): Promise<IProduct> {
    assertObjectId(id, 'product ID');

    if (actor && actor.role !== 'admin') {
      const existing = await Product.findById(id).select('seller');
      if (!existing) {
        throw new AppError(`No product found with ID "${id}"`, 404);
      }
      this.assertProductModifyAccess(existing, actor);
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
  async getProductStats(): Promise<IProductCategoryStats[]> {
    const stats = await Product.aggregate([
      {
        $group: {
          _id: '$category',
          numProducts: { $sum: 1 },
          avgPrice: { $avg: '$price' },
          minPrice: { $min: '$price' },
          maxPrice: { $max: '$price' },
          totalQuantity: { $sum: '$quantity' },
          avgRating: {
            $avg: {
              $cond: [
                { $gt: ['$ratingsQuantity', 0] },
                '$ratingsAverage',
                null,
              ],
            },
          },
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
          avgRating: { $ifNull: [{ $round: ['$avgRating', 1] }, 0] },
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
      .limit(limit)
      .lean();
  }
}

export const productService = new ProductService();
