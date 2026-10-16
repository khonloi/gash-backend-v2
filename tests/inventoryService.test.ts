import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { Product } from '../src/models/Product.js';
import { inventoryService } from '../src/services/inventoryService.js';

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
  await Product.deleteMany({});
});

describe('InventoryService Unit Tests', () => {
  it('should successfully deduct inventory and return order item snapshots', async () => {
    const prod = await Product.create({
      name: 'Running Shoes',
      slug: 'running-shoes',
      description: 'Comfortable shoes',
      sku: 'RS-001',
      price: 120,
      quantity: 10,
      category: 'Footwear',
      status: 'active',
      images: [{ url: 'https://example.com/shoes.jpg', isPrimary: true }],
    });

    const items = await inventoryService.processOrderItems([
      {
        productId: prod._id.toString(),
        quantity: 3,
        size: '10',
        color: 'Blue',
      },
    ]);

    expect(items).toHaveLength(1);
    expect(items[0].name).toBe('Running Shoes');
    expect(items[0].sku).toBe('RS-001');
    expect(items[0].price).toBe(120);
    expect(items[0].quantity).toBe(3);
    expect(items[0].size).toBe('10');
    expect(items[0].color).toBe('Blue');
    expect(items[0].imageUrl).toBe('https://example.com/shoes.jpg');

    const updated = await Product.findById(prod._id);
    expect(updated?.quantity).toBe(7);
  });

  it('should rollback previously decremented items if a subsequent item fails due to insufficient stock', async () => {
    const prod1 = await Product.create({
      name: 'Item 1',
      slug: 'item-1',
      description: 'Description 1',
      sku: 'IT-001',
      price: 50,
      quantity: 10,
      category: 'Apparel',
      status: 'active',
    });

    const prod2 = await Product.create({
      name: 'Item 2',
      slug: 'item-2',
      description: 'Description 2',
      sku: 'IT-002',
      price: 80,
      quantity: 2,
      category: 'Apparel',
      status: 'active',
    });

    await expect(
      inventoryService.processOrderItems([
        { productId: prod1._id.toString(), quantity: 4 },
        { productId: prod2._id.toString(), quantity: 5 }, // Exceeds available stock (2)
      ])
    ).rejects.toThrow('Insufficient stock for "Item 2"');

    // Verify prod1 inventory was rolled back to 10
    const updatedProd1 = await Product.findById(prod1._id);
    expect(updatedProd1?.quantity).toBe(10);

    // Verify prod2 inventory remained 2
    const updatedProd2 = await Product.findById(prod2._id);
    expect(updatedProd2?.quantity).toBe(2);
  });

  it('should fail if product does not exist or is inactive', async () => {
    const inactiveProd = await Product.create({
      name: 'Old Shirt',
      slug: 'old-shirt',
      description: 'Old stock',
      sku: 'OS-001',
      price: 20,
      quantity: 10,
      category: 'Apparel',
      status: 'archived',
    });

    await expect(
      inventoryService.processOrderItems([
        { productId: inactiveProd._id.toString(), quantity: 1 },
      ])
    ).rejects.toThrow('not available for purchase');

    const randomId = new mongoose.Types.ObjectId().toString();
    await expect(
      inventoryService.processOrderItems([{ productId: randomId, quantity: 1 }])
    ).rejects.toThrow(`Product with ID "${randomId}" was not found`);
  });

  it('should restore inventory when cancelOrder or refund is triggered', async () => {
    const prod = await Product.create({
      name: 'Trail Backpack',
      slug: 'trail-backpack',
      description: 'Rugged bag',
      sku: 'TB-001',
      price: 90,
      quantity: 5,
      category: 'Accessories',
      status: 'active',
    });

    await inventoryService.restoreInventory([
      { product: prod._id, quantity: 3 },
    ]);

    const updated = await Product.findById(prod._id);
    expect(updated?.quantity).toBe(8);
  });
});
