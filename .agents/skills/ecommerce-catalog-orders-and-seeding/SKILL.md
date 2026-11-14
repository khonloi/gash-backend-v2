---
name: ecommerce-catalog-orders-and-seeding
description: >-
  Domain guide for the product catalog, atomic inventory reservation, order state machine, shopping
  cart operations, and database seeding scripts in gash-backend-v2. Use when updating catalog
  aggregations, stock decrements, checkout flows, order transitions, cart logic, or MongoDB seeds.
---

# E-Commerce Catalog, Orders, Inventory & Seeding (`gash-backend-v2`)

Use this runbook when working on core commerce models, transactions, state machines, or seed scripts in `d:\Project\gash-backend-v2`.

## Core Modules

- Catalog & Stats: `src/models/Product.ts`, `src/services/productService.ts`, `src/controllers/productController.ts`
- Inventory: `src/services/inventoryService.ts`
- Cart: `src/models/Cart.ts`, `src/services/cartService.ts`, `src/controllers/cartController.ts`
- Orders & State Machine: `src/models/Order.ts`, `src/services/orderService.ts`, `src/services/orderStateMachine.ts`
- Constants & Errors: `src/config/constants.ts`, `src/utils/AppError.ts`, `src/utils/objectId.ts`
- Seeding: `scripts/seedSupersports.ts`

## Inventory & Checkout Invariants

1. **Atomic Stock Check & Decrement (`InventoryService.processOrderItems` in `src/services/inventoryService.ts`)**:
   - Uses atomic `Product.findOneAndUpdate({ _id: item.productId, status: 'active', quantity: { $gte: item.quantity } }, { $inc: { quantity: -item.quantity } }, ...)` with optional Mongoose `ClientSession` support.
   - Differentiates 404 (`not found`), inactive product (`status !== 'active'`), and insufficient stock (`400`) cleanly, with rollback/Saga compensation if a subsequent item in an order fails.
2. **Order State Machine (`src/services/orderStateMachine.ts` & `VALID_ORDER_STATUS_TRANSITIONS` in `src/config/constants.ts`)**:
   - `pending` -> `['confirmed', 'processing', 'shipped', 'cancelled']`
   - `confirmed` -> `['processing', 'shipped', 'cancelled']`
   - `processing` -> `['shipped', 'cancelled']`
   - `shipped` -> `['delivered', 'cancelled']`
   - `delivered` -> `['refunded']`
   - `cancelled` & `refunded` -> terminal states (`[]`).
   - Customers may only cancel orders while status is `'pending'` or `'confirmed'` (`canCustomerCancelOrder`).
3. **Cart Matching (`CartService` in `src/services/cartService.ts`)**:
   - Uniqueness of line items is determined by `(productId, size, color)` via `isSameCartItem` / `findCartItemIndex`.
   - Always validate active product status and `product.quantity >= requestedQuantity` before saving.
4. **Catalog Stats (`ProductService.getProductStats` in `src/services/productService.ts`)**:
   - Aggregates counts, average/min/max prices, total quantity, and average ratings grouped by `category`, sorted descending by `numProducts`.

## Quantitative Seeding (`scripts/seedSupersports.ts`)

- Translates product titles, colors, tags, and descriptions from Vietnamese to English, converts VND pricing (`VND_TO_USD_RATE`), maps categories (`Running`, `Football`, `Swimming`, `Footwear`, `Outdoor`, `Apparel`, `Training`, `Accessories`), and seeds products alongside quantitative associative Users, Carts, Orders, Conversations, and Messages into MongoDB.
- Run offline suite after commerce changes:
  - `pnpm test -- tests/product.test.ts tests/inventoryService.test.ts tests/cart.test.ts tests/order.test.ts tests/orderStateMachine.test.ts`

