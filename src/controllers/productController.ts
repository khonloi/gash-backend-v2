import { Request, Response } from 'express';
import { catchAsync } from '../utils/catchAsync.js';
import { productService } from '../services/productService.js';
import { sendPaginated, sendSuccess } from '../utils/response.js';

export const createProduct = catchAsync(
  async (req: Request, res: Response): Promise<void> => {
    const product = await productService.createProduct(req.body);
    sendSuccess(res, { product }, 201);
  }
);

export const getAllProducts = catchAsync(
  async (req: Request, res: Response): Promise<void> => {
    const result = await productService.getAllProducts(req.query);
    sendPaginated(res, 'products', result);
  }
);

export const getProduct = catchAsync(
  async (req: Request, res: Response): Promise<void> => {
    const product = await productService.getProductById(
      req.params.id as string
    );
    sendSuccess(res, { product });
  }
);

export const getProductBySlug = catchAsync(
  async (req: Request, res: Response): Promise<void> => {
    const product = await productService.getProductBySlug(
      req.params.slug as string
    );
    sendSuccess(res, { product });
  }
);

export const updateProduct = catchAsync(
  async (req: Request, res: Response): Promise<void> => {
    const product = await productService.updateProduct(
      req.params.id as string,
      req.body
    );
    sendSuccess(res, { product });
  }
);

export const deleteProduct = catchAsync(
  async (req: Request, res: Response): Promise<void> => {
    await productService.deleteProduct(req.params.id as string);
    sendSuccess(res, null, 204);
  }
);

export const updateStock = catchAsync(
  async (req: Request, res: Response): Promise<void> => {
    const { quantity, operation } = req.body;
    const product = await productService.updateProductStock(
      req.params.id as string,
      quantity,
      operation
    );
    sendSuccess(res, { product });
  }
);

export const getProductStats = catchAsync(
  async (_req: Request, res: Response): Promise<void> => {
    const stats = await productService.getProductStats();
    sendSuccess(res, { stats });
  }
);

export const getFeaturedProducts = catchAsync(
  async (req: Request, res: Response): Promise<void> => {
    const limit = Number(req.query.limit) || 10;
    const products = await productService.getFeaturedProducts(limit);
    sendSuccess(res, { products }, 200, { results: products.length });
  }
);
