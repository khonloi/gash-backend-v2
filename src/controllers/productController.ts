import { Request, Response } from 'express';
import { catchAsync } from '../utils/catchAsync.js';
import { productService, ProductActor } from '../services/productService.js';
import { sendPaginated, sendSuccess } from '../utils/response.js';

function getOptionalProductActor(req: Request): ProductActor | undefined {
  if (!req.user) return undefined;
  return {
    id: req.user._id.toString(),
    role: req.user.role,
  };
}

export const createProduct = catchAsync(
  async (req: Request, res: Response): Promise<void> => {
    const product = await productService.createProduct(
      req.body,
      req.user?._id?.toString()
    );
    sendSuccess(res, { product }, 201);
  }
);

export const getAllProducts = catchAsync(
  async (req: Request, res: Response): Promise<void> => {
    const result = await productService.getAllProducts(
      req.query,
      getOptionalProductActor(req)
    );
    sendPaginated(res, 'products', result);
  }
);

export const getProduct = catchAsync(
  async (req: Request, res: Response): Promise<void> => {
    const product = await productService.getProductById(
      req.params.id as string,
      getOptionalProductActor(req)
    );
    sendSuccess(res, { product });
  }
);

export const getProductBySlug = catchAsync(
  async (req: Request, res: Response): Promise<void> => {
    const product = await productService.getProductBySlug(
      req.params.slug as string,
      getOptionalProductActor(req)
    );
    sendSuccess(res, { product });
  }
);

export const updateProduct = catchAsync(
  async (req: Request, res: Response): Promise<void> => {
    const product = await productService.updateProduct(
      req.params.id as string,
      req.body,
      getOptionalProductActor(req)
    );
    sendSuccess(res, { product });
  }
);

export const deleteProduct = catchAsync(
  async (req: Request, res: Response): Promise<void> => {
    await productService.deleteProduct(req.params.id as string);
    res.status(204).send();
  }
);

export const updateStock = catchAsync(
  async (req: Request, res: Response): Promise<void> => {
    const { quantity, operation } = req.body;
    const product = await productService.updateProductStock(
      req.params.id as string,
      quantity,
      operation,
      getOptionalProductActor(req)
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
