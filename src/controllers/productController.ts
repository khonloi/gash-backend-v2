import { Request, Response } from 'express';
import { catchAsync } from '../utils/catchAsync.js';
import { productService } from '../services/productService.js';

export const createProduct = catchAsync(
  async (req: Request, res: Response): Promise<void> => {
    const product = await productService.createProduct(req.body);

    res.status(201).json({
      status: 'success',
      data: { product },
    });
  }
);

export const getAllProducts = catchAsync(
  async (req: Request, res: Response): Promise<void> => {
    const result = await productService.getAllProducts(req.query);

    res.status(200).json({
      status: 'success',
      results: result.data.length,
      pagination: {
        page: result.page,
        limit: result.limit,
        totalPages: result.totalPages,
        totalResults: result.totalResults,
      },
      data: { products: result.data },
    });
  }
);

export const getProduct = catchAsync(
  async (req: Request, res: Response): Promise<void> => {
    const product = await productService.getProductById(
      req.params.id as string
    );

    res.status(200).json({
      status: 'success',
      data: { product },
    });
  }
);

export const getProductBySlug = catchAsync(
  async (req: Request, res: Response): Promise<void> => {
    const product = await productService.getProductBySlug(
      req.params.slug as string
    );

    res.status(200).json({
      status: 'success',
      data: { product },
    });
  }
);

export const updateProduct = catchAsync(
  async (req: Request, res: Response): Promise<void> => {
    const product = await productService.updateProduct(
      req.params.id as string,
      req.body
    );

    res.status(200).json({
      status: 'success',
      data: { product },
    });
  }
);

export const deleteProduct = catchAsync(
  async (req: Request, res: Response): Promise<void> => {
    await productService.deleteProduct(req.params.id as string);

    res.status(204).json({
      status: 'success',
      data: null,
    });
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

    res.status(200).json({
      status: 'success',
      data: { product },
    });
  }
);

export const getProductStats = catchAsync(
  async (_req: Request, res: Response): Promise<void> => {
    const stats = await productService.getProductStats();

    res.status(200).json({
      status: 'success',
      data: { stats },
    });
  }
);

export const getFeaturedProducts = catchAsync(
  async (req: Request, res: Response): Promise<void> => {
    const limit = Number(req.query.limit) || 10;
    const products = await productService.getFeaturedProducts(limit);

    res.status(200).json({
      status: 'success',
      results: products.length,
      data: { products },
    });
  }
);
