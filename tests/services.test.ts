import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { User } from '../src/models/User.js';
import { Product } from '../src/models/Product.js';
import { Order } from '../src/models/Order.js';
import { Cart } from '../src/models/Cart.js';
import { productService } from '../src/services/productService.js';
import { userService } from '../src/services/userService.js';
import { orderService } from '../src/services/orderService.js';
import { CreateOrderInput } from '../src/validations/orderValidation.js';

let mongoServer: MongoMemoryServer;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

beforeEach(async () => {
  await Promise.all([
    User.deleteMany({}),
    Product.deleteMany({}),
    Order.deleteMany({}),
    Cart.deleteMany({}),
  ]);
});

describe('Service Edge Cases & Branch Coverage Tests', () => {
  describe('ProductService', () => {
    it('updateProduct should validate ObjectId format', async () => {
      await expect(
        productService.updateProduct('invalid-id', { name: 'Test' })
      ).rejects.toThrow('Invalid product ID format');
    });

    it('updateProduct should reject duplicate SKU', async () => {
      await Product.create({
        name: 'Product 1',
        slug: 'prod-1',
        description: 'Product description 1',
        sku: 'SKU-001',
        price: 100,
        quantity: 10,
        category: 'Shoes',
      });
      const p2 = await Product.create({
        name: 'Product 2',
        slug: 'prod-2',
        description: 'Product description 2',
        sku: 'SKU-002',
        price: 150,
        quantity: 15,
        category: 'Shoes',
      });

      await expect(
        productService.updateProduct(p2._id.toString(), { sku: 'SKU-001' })
      ).rejects.toThrow('already exists');
    });

    it('updateProduct should throw 404 when product is not found', async () => {
      const randomId = new mongoose.Types.ObjectId().toString();
      await expect(
        productService.updateProduct(randomId, { name: 'Nonexistent' })
      ).rejects.toThrow('No product found with ID');
    });

    it('updateProduct should update slug when name changes', async () => {
      const product = await Product.create({
        name: 'Original Name',
        slug: 'original-name',
        description: 'Original description',
        sku: 'SKU-ORIG',
        price: 50,
        quantity: 5,
        category: 'Apparel',
      });

      const updated = await productService.updateProduct(
        product._id.toString(),
        { name: 'Brand New Name' }
      );
      expect(updated.name).toBe('Brand New Name');
      expect(updated.slug).toBe('brand-new-name');
    });

    it('deleteProduct should validate ObjectId format and throw 404 on missing product', async () => {
      await expect(productService.deleteProduct('bad-id')).rejects.toThrow(
        'Invalid product ID format'
      );

      const randomId = new mongoose.Types.ObjectId().toString();
      await expect(productService.deleteProduct(randomId)).rejects.toThrow(
        'No product found with ID'
      );
    });

    it('deleteProduct should successfully remove product', async () => {
      const product = await Product.create({
        name: 'To Delete',
        slug: 'to-delete',
        description: 'To delete description',
        sku: 'SKU-DEL',
        price: 20,
        quantity: 2,
        category: 'Accessories',
      });

      await productService.deleteProduct(product._id.toString());
      const found = await Product.findById(product._id);
      expect(found).toBeNull();
    });

    describe('updateProductStock operations', () => {
      it('should validate ID format and operation type', async () => {
        await expect(
          productService.updateProductStock('bad-id', 5, 'set')
        ).rejects.toThrow('Invalid product ID format');

        const randomId = new mongoose.Types.ObjectId().toString();
        await expect(
          // @ts-expect-error Testing invalid operation at runtime
          productService.updateProductStock(randomId, 5, 'unknown-op')
        ).rejects.toThrow('Invalid stock operation');
      });

      it('operation "set" should handle negative quantities and 404', async () => {
        const randomId = new mongoose.Types.ObjectId().toString();
        await expect(
          productService.updateProductStock(randomId, -5, 'set')
        ).rejects.toThrow('Stock quantity cannot be negative');

        await expect(
          productService.updateProductStock(randomId, 10, 'set')
        ).rejects.toThrow('No product found with ID');
      });

      it('operation "increment" should handle quantity <= 0 and 404', async () => {
        const randomId = new mongoose.Types.ObjectId().toString();
        await expect(
          productService.updateProductStock(randomId, 0, 'increment')
        ).rejects.toThrow('Increment amount must be greater than 0');

        await expect(
          productService.updateProductStock(randomId, 5, 'increment')
        ).rejects.toThrow('No product found with ID');
      });

      it('operation "decrement" should handle quantity <= 0, 404, and insufficient stock', async () => {
        const randomId = new mongoose.Types.ObjectId().toString();
        await expect(
          productService.updateProductStock(randomId, 0, 'decrement')
        ).rejects.toThrow('Decrement amount must be greater than 0');

        await expect(
          productService.updateProductStock(randomId, 5, 'decrement')
        ).rejects.toThrow('No product found with ID');

        const product = await Product.create({
          name: 'Low Stock Item',
          slug: 'low-stock',
          description: 'Low stock description',
          sku: 'SKU-LOW',
          price: 30,
          quantity: 3,
          category: 'Gear',
        });

        await expect(
          productService.updateProductStock(
            product._id.toString(),
            10,
            'decrement'
          )
        ).rejects.toThrow('Insufficient stock');
      });

      it('operation "decrement" should succeed atomically when stock is sufficient', async () => {
        const product = await Product.create({
          name: 'Stock Item',
          slug: 'stock-item',
          description: 'Stock item description',
          sku: 'SKU-STK',
          price: 30,
          quantity: 10,
          category: 'Gear',
        });

        const updated = await productService.updateProductStock(
          product._id.toString(),
          4,
          'decrement'
        );
        expect(updated.quantity).toBe(6);
      });
    });

    it('getProductStats should aggregate category statistics', async () => {
      await Product.create([
        {
          name: 'Shoe 1',
          slug: 'shoe-1',
          description: 'Shoe 1 description',
          sku: 'SKU-SH1',
          price: 100,
          quantity: 10,
          category: 'Footwear',
          ratingsAverage: 4.5,
        },
        {
          name: 'Shoe 2',
          slug: 'shoe-2',
          description: 'Shoe 2 description',
          sku: 'SKU-SH2',
          price: 200,
          quantity: 5,
          category: 'Footwear',
          ratingsAverage: 4.0,
        },
        {
          name: 'Shirt 1',
          slug: 'shirt-1',
          description: 'Shirt 1 description',
          sku: 'SKU-SHIRT1',
          price: 50,
          quantity: 20,
          category: 'Apparel',
          ratingsAverage: 5.0,
        },
      ]);

      const stats = await productService.getProductStats();
      expect(stats.length).toBe(2);

      const footwear = stats.find((s) => s.category === 'Footwear');
      expect(footwear).toBeDefined();
      expect(footwear?.numProducts).toBe(2);
      expect(footwear?.totalQuantity).toBe(15);
      expect(footwear?.minPrice).toBe(100);
      expect(footwear?.maxPrice).toBe(200);
    });
  });

  describe('UserService', () => {
    it('getMe should throw 404 when user is not found', async () => {
      const randomId = new mongoose.Types.ObjectId().toString();
      await expect(userService.getMe(randomId)).rejects.toThrow(
        'User not found'
      );
    });

    it('updateMe should throw 404 when user is not found', async () => {
      const randomId = new mongoose.Types.ObjectId().toString();
      await expect(
        userService.updateMe(randomId, { firstName: 'Updated' })
      ).rejects.toThrow('User not found');
    });

    it('changePassword should throw 404 when user is not found', async () => {
      const randomId = new mongoose.Types.ObjectId().toString();
      await expect(
        userService.changePassword(randomId, {
          currentPassword: 'Password123!',
          newPassword: 'NewPassword123!',
          newPasswordConfirm: 'NewPassword123!',
        })
      ).rejects.toThrow('User not found');
    });

    it('deactivateMe should throw 404 when user is not found', async () => {
      const randomId = new mongoose.Types.ObjectId().toString();
      await expect(userService.deactivateMe(randomId)).rejects.toThrow(
        'User not found'
      );
    });

    it('getAddresses should throw 404 when user is not found', async () => {
      const randomId = new mongoose.Types.ObjectId().toString();
      await expect(userService.getAddresses(randomId)).rejects.toThrow(
        'User not found'
      );
    });

    describe('Address Management', () => {
      it('addAddress should throw 404 when user is not found', async () => {
        const randomId = new mongoose.Types.ObjectId().toString();
        await expect(
          userService.addAddress(randomId, {
            label: 'Home',
            fullName: 'Jane',
            addressLine1: 'Street 1',
            city: 'Hanoi',
            state: 'HN',
            postalCode: '10000',
            country: 'Vietnam',
            isDefault: false,
          })
        ).rejects.toThrow('User not found');
      });

      it('addAddress should set first address as default, and unset old default when new default is added', async () => {
        const user = await User.create({
          firstName: 'Addr',
          lastName: 'User',
          email: 'addr@example.com',
          password: 'Password123!',
        });

        // 1st address added should be default
        const addresses1 = await userService.addAddress(user._id.toString(), {
          label: 'Home',
          fullName: 'Address 1',
          addressLine1: 'Street 1',
          city: 'Hanoi',
          state: 'HN',
          postalCode: '10000',
          country: 'Vietnam',
          isDefault: false, // will be auto-set to true because it's first
        });
        expect(addresses1[0].isDefault).toBe(true);

        // 2nd address added as default should un-default the first
        const addresses2 = await userService.addAddress(user._id.toString(), {
          label: 'Office',
          fullName: 'Address 2',
          addressLine1: 'Street 2',
          city: 'HCMC',
          state: 'SG',
          postalCode: '70000',
          country: 'Vietnam',
          isDefault: true,
        });
        expect(addresses2.length).toBe(2);
        expect(addresses2[0].isDefault).toBe(false);
        expect(addresses2[1].isDefault).toBe(true);
      });

      it('updateAddress should validate user and address existence, and handle isDefault switch', async () => {
        const randomId = new mongoose.Types.ObjectId().toString();
        await expect(
          userService.updateAddress(randomId, randomId, { city: 'Da Nang' })
        ).rejects.toThrow('User not found');

        const user = await User.create({
          firstName: 'User',
          lastName: 'Two',
          email: 'u2@example.com',
          password: 'Password123!',
          addresses: [
            {
              fullName: 'A1',
              addressLine1: 'L1',
              city: 'HN',
              state: 'HN',
              postalCode: '10000',
              country: 'VN',
              isDefault: true,
            },
            {
              fullName: 'A2',
              addressLine1: 'L2',
              city: 'DN',
              state: 'DN',
              postalCode: '55000',
              country: 'VN',
              isDefault: false,
            },
          ],
        });

        const a2Id = user.addresses[1]._id!.toString();

        await expect(
          userService.updateAddress(user._id.toString(), randomId, {
            city: 'Hue',
          })
        ).rejects.toThrow('No address found with ID');

        const updatedAddresses = await userService.updateAddress(
          user._id.toString(),
          a2Id,
          { isDefault: true }
        );

        expect(updatedAddresses[0].isDefault).toBe(false);
        expect(updatedAddresses[1].isDefault).toBe(true);
      });

      it('removeAddress should validate existence and promote next address if default was removed', async () => {
        const randomId = new mongoose.Types.ObjectId().toString();
        await expect(
          userService.removeAddress(randomId, randomId)
        ).rejects.toThrow('User not found');

        const user = await User.create({
          firstName: 'User',
          lastName: 'Three',
          email: 'u3@example.com',
          password: 'Password123!',
          addresses: [
            {
              fullName: 'A1',
              addressLine1: 'L1',
              city: 'HN',
              state: 'HN',
              postalCode: '10000',
              country: 'VN',
              isDefault: true,
            },
            {
              fullName: 'A2',
              addressLine1: 'L2',
              city: 'DN',
              state: 'DN',
              postalCode: '55000',
              country: 'VN',
              isDefault: false,
            },
          ],
        });

        const a1Id = user.addresses[0]._id!.toString();

        await expect(
          userService.removeAddress(user._id.toString(), randomId)
        ).rejects.toThrow('No address found with ID');

        const remaining = await userService.removeAddress(
          user._id.toString(),
          a1Id
        );
        expect(remaining.length).toBe(1);
        expect(remaining[0].isDefault).toBe(true); // Promoted to default!
      });
    });

    describe('Admin user management', () => {
      it('getUserById should validate ObjectId and throw 404 when missing', async () => {
        await expect(userService.getUserById('bad-id')).rejects.toThrow(
          'Invalid user ID format'
        );

        const randomId = new mongoose.Types.ObjectId().toString();
        await expect(userService.getUserById(randomId)).rejects.toThrow(
          'No user found with ID'
        );
      });

      it('updateUserRole should validate ObjectId, update role, and throw 404 when missing', async () => {
        await expect(
          userService.updateUserRole('bad-id', 'admin')
        ).rejects.toThrow('Invalid user ID format');

        const randomId = new mongoose.Types.ObjectId().toString();
        await expect(
          userService.updateUserRole(randomId, 'admin')
        ).rejects.toThrow('No user found with ID');

        const user = await User.create({
          firstName: 'Role',
          lastName: 'Test',
          email: 'role@example.com',
          password: 'Password123!',
          role: 'customer',
        });

        const updated = await userService.updateUserRole(
          user._id.toString(),
          'seller'
        );
        expect(updated.role).toBe('seller');
      });

      it('deleteUser should validate ObjectId, delete user, and throw 404 when missing', async () => {
        await expect(userService.deleteUser('bad-id')).rejects.toThrow(
          'Invalid user ID format'
        );

        const randomId = new mongoose.Types.ObjectId().toString();
        await expect(userService.deleteUser(randomId)).rejects.toThrow(
          'No user found with ID'
        );

        const user = await User.create({
          firstName: 'Del',
          lastName: 'User',
          email: 'del@example.com',
          password: 'Password123!',
        });

        await userService.deleteUser(user._id.toString());
        const found = await User.findById(user._id);
        expect(found).toBeNull();
      });
    });
  });

  describe('OrderService', () => {
    describe('createOrder edge cases', () => {
      it('should validate userId format if provided', async () => {
        await expect(
          orderService.createOrder('bad-user-id', {} as CreateOrderInput)
        ).rejects.toThrow('Invalid user ID format');
      });

      it('should throw 400 when user cart is empty', async () => {
        const user = await User.create({
          firstName: 'Cart',
          lastName: 'Empty',
          email: 'emptycart@example.com',
          password: 'Password123!',
        });

        await expect(
          orderService.createOrder(user._id.toString(), {
            shippingAddress: {
              fullName: 'Jane',
              phone: '0123456789',
              addressLine1: 'Street 1',
              city: 'HN',
            },
          } as CreateOrderInput)
        ).rejects.toThrow('Your cart is empty');
      });

      it('should validate item productId format', async () => {
        await expect(
          orderService.createOrder(undefined, {
            items: [{ productId: 'bad-prod-id', quantity: 1 }],
            shippingAddress: {
              fullName: 'Jane',
              phone: '0123456789',
              addressLine1: 'Street 1',
              city: 'HN',
            },
          } as CreateOrderInput)
        ).rejects.toThrow('Invalid product ID format');
      });

      it('should throw 404 when product does not exist in DB', async () => {
        const randomId = new mongoose.Types.ObjectId().toString();
        await expect(
          orderService.createOrder(undefined, {
            items: [{ productId: randomId, quantity: 1 }],
            shippingAddress: {
              fullName: 'Jane',
              phone: '0123456789',
              addressLine1: 'Street 1',
              city: 'HN',
            },
          } as CreateOrderInput)
        ).rejects.toThrow('was not found');
      });

      it('should throw 400 when product is draft or inactive', async () => {
        const draftProduct = await Product.create({
          name: 'Draft Item',
          slug: 'draft-item',
          description: 'Draft description',
          sku: 'SKU-DRAFT',
          price: 100,
          quantity: 10,
          category: 'Drafts',
          status: 'draft',
        });

        await expect(
          orderService.createOrder(undefined, {
            items: [{ productId: draftProduct._id.toString(), quantity: 1 }],
            shippingAddress: {
              fullName: 'Jane',
              phone: '0123456789',
              addressLine1: 'Street 1',
              city: 'HN',
            },
          } as CreateOrderInput)
        ).rejects.toThrow('not available for purchase');
      });

      it('should rollback decremented inventory if subsequent item fails', async () => {
        const p1 = await Product.create({
          name: 'P1 In Stock',
          slug: 'p1-stock',
          description: 'P1 description',
          sku: 'SKU-P1',
          price: 50,
          quantity: 10,
          category: 'Test',
          status: 'active',
        });
        const p2 = await Product.create({
          name: 'P2 Out Of Stock',
          slug: 'p2-nostock',
          description: 'P2 description',
          sku: 'SKU-P2',
          price: 50,
          quantity: 1,
          category: 'Test',
          status: 'active',
        });

        await expect(
          orderService.createOrder(undefined, {
            items: [
              { productId: p1._id.toString(), quantity: 5 },
              { productId: p2._id.toString(), quantity: 10 }, // Fails here!
            ],
            shippingAddress: {
              fullName: 'Jane',
              phone: '0123456789',
              addressLine1: 'Street 1',
              city: 'HN',
            },
          } as CreateOrderInput)
        ).rejects.toThrow('Insufficient stock');

        // P1 should be restored back to 10
        const restoredP1 = await Product.findById(p1._id);
        expect(restoredP1?.quantity).toBe(10);
      });
    });

    describe('Order access & querying', () => {
      it('getOrderById should throw 404 on missing order', async () => {
        const randomId = new mongoose.Types.ObjectId().toString();
        await expect(
          orderService.getOrderById(randomId, randomId, 'customer')
        ).rejects.toThrow('Order not found');
      });

      it('getOrderById should throw 403 when customer views someone else order, but permit admin', async () => {
        const owner = await User.create({
          firstName: 'Owner',
          lastName: 'User',
          email: 'owner@example.com',
          password: 'Password123!',
        });
        const outsider = await User.create({
          firstName: 'Outsider',
          lastName: 'User',
          email: 'outsider@example.com',
          password: 'Password123!',
        });
        const product = await Product.create({
          name: 'Product Details',
          slug: 'prod-details',
          description: 'Product details description',
          sku: 'SKU-PR',
          price: 10,
          quantity: 10,
          category: 'Test Category',
          status: 'active',
        });

        const order = await orderService.createOrder(owner._id.toString(), {
          items: [{ productId: product._id.toString(), quantity: 1 }],
          shippingAddress: {
            fullName: 'Owner',
            phone: '0123456789',
            addressLine1: 'Line',
            city: 'City',
          },
        } as CreateOrderInput);

        // Outsider as customer -> 403
        await expect(
          orderService.getOrderById(
            order._id.toString(),
            outsider._id.toString(),
            'customer'
          )
        ).rejects.toThrow('You do not have permission to view this order');

        // Admin -> succeeds
        const adminOrder = await orderService.getOrderById(
          order._id.toString(),
          outsider._id.toString(),
          'admin'
        );
        expect(adminOrder._id.toString()).toBe(order._id.toString());
      });

      it('getUserOrders should validate userId format and apply status filtering', async () => {
        await expect(orderService.getUserOrders('bad-id', {})).rejects.toThrow(
          'Invalid user ID format'
        );

        const user = await User.create({
          firstName: 'User',
          lastName: 'Filter',
          email: 'filter@example.com',
          password: 'Password123!',
        });
        const product = await Product.create({
          name: 'Product Filter',
          slug: 'prod-f',
          description: 'Product filter description',
          sku: 'SKU-F',
          price: 10,
          quantity: 10,
          category: 'Test Category',
          status: 'active',
        });

        await orderService.createOrder(user._id.toString(), {
          items: [{ productId: product._id.toString(), quantity: 1 }],
          shippingAddress: {
            fullName: 'User',
            phone: '0123456789',
            addressLine1: 'Line',
            city: 'City',
          },
        } as CreateOrderInput);

        const resultPending = await orderService.getUserOrders(
          user._id.toString(),
          { status: 'pending' }
        );
        expect(resultPending.totalResults).toBe(1);

        const resultDelivered = await orderService.getUserOrders(
          user._id.toString(),
          { status: 'delivered' }
        );
        expect(resultDelivered.totalResults).toBe(0);
      });
    });

    describe('cancelOrder edge cases', () => {
      it('should prevent unauthorized customers, delivered, and shipped cancellations', async () => {
        const owner = await User.create({
          firstName: 'Cancel',
          lastName: 'Owner',
          email: 'cancelowner@example.com',
          password: 'Password123!',
        });
        const otherUser = await User.create({
          firstName: 'Other',
          lastName: 'User',
          email: 'othercancel@example.com',
          password: 'Password123!',
        });
        const product = await Product.create({
          name: 'Product Cancel',
          slug: 'p-cancel',
          description: 'Product cancel description',
          sku: 'SKU-C1',
          price: 20,
          quantity: 10,
          category: 'Test Category',
          status: 'active',
        });

        const order = await orderService.createOrder(owner._id.toString(), {
          items: [{ productId: product._id.toString(), quantity: 2 }],
          shippingAddress: {
            fullName: 'Cancel',
            phone: '0123456789',
            addressLine1: 'Line',
            city: 'City',
          },
        } as CreateOrderInput);

        // 1) Other user cannot cancel
        await expect(
          orderService.cancelOrder(
            order._id.toString(),
            otherUser._id.toString(),
            'customer'
          )
        ).rejects.toThrow('You do not have permission to cancel this order');

        // 2) Delivered orders cannot be cancelled
        order.status = 'delivered';
        await order.save();
        await expect(
          orderService.cancelOrder(
            order._id.toString(),
            owner._id.toString(),
            'customer'
          )
        ).rejects.toThrow('Delivered orders cannot be cancelled');

        // 3) Shipped orders cannot be cancelled by customer
        order.status = 'shipped';
        await order.save();
        await expect(
          orderService.cancelOrder(
            order._id.toString(),
            owner._id.toString(),
            'customer'
          )
        ).rejects.toThrow('cannot be cancelled by customer');

        // 4) Successful cancel by customer when pending, restoring inventory
        order.status = 'pending';
        order.paymentStatus = 'paid';
        await order.save();

        const cancelled = await orderService.cancelOrder(
          order._id.toString(),
          owner._id.toString(),
          'customer'
        );
        expect(cancelled.status).toBe('cancelled');
        expect(cancelled.paymentStatus).toBe('refunded');

        // Stock restored back
        const restoredProd = await Product.findById(product._id);
        expect(restoredProd?.quantity).toBe(10);

        // 5) Already cancelled order
        await expect(
          orderService.cancelOrder(
            order._id.toString(),
            owner._id.toString(),
            'customer'
          )
        ).rejects.toThrow('already cancelled');
      });
    });

    describe('updateOrderStatus and updatePaymentStatus transitions', () => {
      it('updateOrderStatus should handle unchanged status, invalid transitions, and timestamp updates', async () => {
        const product = await Product.create({
          name: 'Transition Item',
          slug: 'trans-item',
          description: 'Transition item description',
          sku: 'SKU-TR',
          price: 50,
          quantity: 10,
          category: 'Test Category',
          status: 'active',
        });

        const order = await orderService.createOrder(undefined, {
          items: [{ productId: product._id.toString(), quantity: 1 }],
          paymentMethod: 'cod',
          shippingAddress: {
            fullName: 'Trans',
            phone: '0123456789',
            addressLine1: 'Line',
            city: 'City',
          },
        } as CreateOrderInput);

        // Unchanged status returns order immediately
        const same = await orderService.updateOrderStatus(
          order._id.toString(),
          'pending'
        );
        expect(same.status).toBe('pending');

        // Invalid transition: pending directly to delivered
        await expect(
          orderService.updateOrderStatus(order._id.toString(), 'delivered')
        ).rejects.toThrow('Cannot transition order status');

        // Valid transition: pending -> confirmed -> processing -> shipped
        await orderService.updateOrderStatus(order._id.toString(), 'confirmed');
        await orderService.updateOrderStatus(
          order._id.toString(),
          'processing'
        );
        const shipped = await orderService.updateOrderStatus(
          order._id.toString(),
          'shipped'
        );
        expect(shipped.status).toBe('shipped');
        expect(shipped.shippedAt).toBeDefined();

        // Shipped -> delivered with COD auto-marks paid
        const delivered = await orderService.updateOrderStatus(
          order._id.toString(),
          'delivered'
        );
        expect(delivered.status).toBe('delivered');
        expect(delivered.deliveredAt).toBeDefined();
        expect(delivered.paymentStatus).toBe('paid');
      });

      it('updateOrderStatus to cancelled by admin should restore inventory', async () => {
        const product = await Product.create({
          name: 'Admin Cancel Item',
          slug: 'admin-cancel',
          description: 'Admin cancel description',
          sku: 'SKU-AC',
          price: 50,
          quantity: 10,
          category: 'Test Category',
          status: 'active',
        });

        const order = await orderService.createOrder(undefined, {
          items: [{ productId: product._id.toString(), quantity: 3 }],
          shippingAddress: {
            fullName: 'AdminCancel',
            phone: '0123456789',
            addressLine1: 'Line',
            city: 'City',
          },
        } as CreateOrderInput);

        // Stock decreased to 7
        expect((await Product.findById(product._id))?.quantity).toBe(7);

        // Cancel order via status update
        const cancelled = await orderService.updateOrderStatus(
          order._id.toString(),
          'cancelled'
        );
        expect(cancelled.status).toBe('cancelled');
        expect(cancelled.cancelReason).toBe('Cancelled by administrator');

        // Stock restored back to 10
        expect((await Product.findById(product._id))?.quantity).toBe(10);
      });

      it('updatePaymentStatus to "paid" should auto-confirm a pending order', async () => {
        const product = await Product.create({
          name: 'Payment Item',
          slug: 'pay-item',
          description: 'Payment item description',
          sku: 'SKU-PAY',
          price: 50,
          quantity: 10,
          category: 'Test Category',
          status: 'active',
        });

        const order = await orderService.createOrder(undefined, {
          items: [{ productId: product._id.toString(), quantity: 1 }],
          shippingAddress: {
            fullName: 'Pay',
            phone: '0123456789',
            addressLine1: 'Line',
            city: 'City',
          },
        } as CreateOrderInput);

        expect(order.status).toBe('pending');
        expect(order.paymentStatus).toBe('pending');

        const updated = await orderService.updatePaymentStatus(
          order._id.toString(),
          'paid'
        );
        expect(updated.paymentStatus).toBe('paid');
        expect(updated.status).toBe('confirmed'); // Auto confirmed!
      });
    });
  });
});
