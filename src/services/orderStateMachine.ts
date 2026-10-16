import { OrderStatus } from '../types/index.js';
import { VALID_ORDER_STATUS_TRANSITIONS } from '../config/constants.js';
import { AppError } from '../utils/AppError.js';

/**
 * Validates whether transitioning from currentStatus to targetStatus is permitted.
 * Throws a 400 AppError if the transition is invalid.
 */
export function validateOrderStatusTransition(
  currentStatus: OrderStatus,
  targetStatus: OrderStatus
): void {
  if (currentStatus === targetStatus) return;

  const allowedTransitions =
    VALID_ORDER_STATUS_TRANSITIONS[currentStatus] || [];
  if (!allowedTransitions.includes(targetStatus)) {
    throw new AppError(
      `Cannot transition order status from "${currentStatus}" to "${targetStatus}"`,
      400
    );
  }
}

/**
 * Checks whether a customer is allowed to cancel an order given its current status.
 */
export function canCustomerCancelOrder(status: OrderStatus): boolean {
  return ['pending', 'confirmed'].includes(status);
}
