import {
  validateOrderStatusTransition,
  canCustomerCancelOrder,
} from '../src/services/orderStateMachine.js';
import { AppError } from '../src/utils/AppError.js';

describe('Order State Machine Tests', () => {
  describe('validateOrderStatusTransition', () => {
    it('should allow valid transitions', () => {
      expect(() =>
        validateOrderStatusTransition('pending', 'confirmed')
      ).not.toThrow();
      expect(() =>
        validateOrderStatusTransition('confirmed', 'processing')
      ).not.toThrow();
      expect(() =>
        validateOrderStatusTransition('processing', 'shipped')
      ).not.toThrow();
      expect(() =>
        validateOrderStatusTransition('shipped', 'delivered')
      ).not.toThrow();
      expect(() =>
        validateOrderStatusTransition('delivered', 'refunded')
      ).not.toThrow();
      expect(() =>
        validateOrderStatusTransition('pending', 'cancelled')
      ).not.toThrow();
    });

    it('should allow transitioning to same status as a no-op', () => {
      expect(() =>
        validateOrderStatusTransition('processing', 'processing')
      ).not.toThrow();
    });

    it('should throw 400 AppError for invalid status transitions', () => {
      expect(() => validateOrderStatusTransition('shipped', 'pending')).toThrow(
        AppError
      );
      expect(() =>
        validateOrderStatusTransition('delivered', 'cancelled')
      ).toThrow(
        'Cannot transition order status from "delivered" to "cancelled"'
      );
      expect(() =>
        validateOrderStatusTransition('cancelled', 'confirmed')
      ).toThrow(
        'Cannot transition order status from "cancelled" to "confirmed"'
      );
    });
  });

  describe('canCustomerCancelOrder', () => {
    it('should return true for pending and confirmed orders', () => {
      expect(canCustomerCancelOrder('pending')).toBe(true);
      expect(canCustomerCancelOrder('confirmed')).toBe(true);
    });

    it('should return false for processing, shipped, delivered, cancelled orders', () => {
      expect(canCustomerCancelOrder('processing')).toBe(false);
      expect(canCustomerCancelOrder('shipped')).toBe(false);
      expect(canCustomerCancelOrder('delivered')).toBe(false);
      expect(canCustomerCancelOrder('cancelled')).toBe(false);
      expect(canCustomerCancelOrder('refunded')).toBe(false);
    });
  });
});
