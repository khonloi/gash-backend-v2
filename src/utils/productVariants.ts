import { IProduct, IProductVariant } from '../types/index.js';
import { AppError } from './AppError.js';

export interface ResolvedVariant {
  hasVariants: boolean;
  sku: string;
  unitPrice: number;
  availableStock: number;
  size?: string;
  color?: string;
}

export function normalizeVariantAttr(val?: string | null): string | undefined {
  const trimmed = val?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

export function computeVariantUnitPrice(
  basePrice: number,
  variant: Pick<IProductVariant, 'price' | 'priceModifier' | 'sku'>
): number {
  const priceCents =
    variant.price !== undefined
      ? Math.round(variant.price * 100)
      : Math.round(basePrice * 100) +
        Math.round((variant.priceModifier ?? 0) * 100);

  if (priceCents < 0) {
    throw new AppError(
      `Computed price for variant SKU "${variant.sku}" cannot be negative`,
      400
    );
  }

  return priceCents / 100;
}

/**
 * Validates and normalizes per-SKU product variants, ensuring unique SKUs,
 * unique (size, color) pairs, non-negative prices, and returns total stock sum.
 */
export function normalizeAndValidateVariants(
  basePrice: number,
  variants: IProductVariant[]
): { normalizedVariants: IProductVariant[]; totalStock: number } {
  const seenSkus = new Set<string>();
  const seenCombos = new Set<string>();
  let totalStock = 0;

  const normalizedVariants = variants.map((v) => {
    const sku = v.sku.trim().toUpperCase();
    if (!sku) {
      throw new AppError('Variant SKU cannot be empty', 400);
    }
    if (seenSkus.has(sku)) {
      throw new AppError(`Duplicate variant SKU "${sku}" within product`, 400);
    }
    seenSkus.add(sku);

    const size = normalizeVariantAttr(v.size);
    const color = normalizeVariantAttr(v.color);
    const comboKey = `${(size ?? '').toLowerCase()}::${(color ?? '').toLowerCase()}`;
    if (seenCombos.has(comboKey)) {
      throw new AppError(
        `Duplicate variant combination (size: ${size ?? 'none'}, color: ${color ?? 'none'})`,
        400
      );
    }
    seenCombos.add(comboKey);

    computeVariantUnitPrice(basePrice, { ...v, sku });
    const stock = Math.max(0, Math.floor(v.stock ?? 0));
    totalStock += stock;

    return {
      ...v,
      sku,
      size,
      color,
      priceModifier: v.priceModifier ?? 0,
      stock,
    };
  });

  return { normalizedVariants, totalStock };
}

/**
 * Resolves the sellable SKU, unit price, and stock for a product + (size, color) selection.
 * Simple products without variants use top-level sku/price/quantity;
 * products with variants require an exact matching variant SKU combination.
 */
export function resolveProductVariant(
  product: Pick<IProduct, 'price' | 'sku' | 'quantity' | 'variants'>,
  selection: { size?: string; color?: string }
): ResolvedVariant {
  const reqSize = normalizeVariantAttr(selection.size);
  const reqColor = normalizeVariantAttr(selection.color);

  if (!product.variants || product.variants.length === 0) {
    return {
      hasVariants: false,
      sku: product.sku,
      unitPrice: product.price,
      availableStock: product.quantity,
      size: reqSize,
      color: reqColor,
    };
  }

  const reqSizeLower = reqSize?.toLowerCase();
  const reqColorLower = reqColor?.toLowerCase();

  const matched = product.variants.find((v) => {
    const vSize = normalizeVariantAttr(v.size)?.toLowerCase();
    const vColor = normalizeVariantAttr(v.color)?.toLowerCase();
    return vSize === reqSizeLower && vColor === reqColorLower;
  });

  if (!matched) {
    throw new AppError(
      'Selected product variant (size/color) is not available',
      400
    );
  }

  return {
    hasVariants: true,
    sku: matched.sku,
    unitPrice: computeVariantUnitPrice(product.price, matched),
    availableStock: matched.stock,
    size: normalizeVariantAttr(matched.size),
    color: normalizeVariantAttr(matched.color),
  };
}
