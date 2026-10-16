import { SchemaDefinition } from 'mongoose';

export interface AddressSchemaOptions {
  defaultCountry?: string;
  requirePhone?: boolean;
  requireState?: boolean;
  requirePostalCode?: boolean;
  includeLabel?: boolean;
  includeIsDefault?: boolean;
  phoneRequiredMessage?: string;
  fullNameRequiredMessage?: string;
}

/**
 * Reusable Mongoose schema definition for addresses (User addresses & Order shipping addresses)
 */
export function createAddressSchemaDefinition(
  options: AddressSchemaOptions = {}
): SchemaDefinition {
  const {
    defaultCountry = 'Vietnam',
    requirePhone = false,
    requireState = false,
    requirePostalCode = false,
    includeLabel = false,
    includeIsDefault = false,
    phoneRequiredMessage = 'Phone number is required',
    fullNameRequiredMessage = 'Full name is required',
  } = options;

  const definition: SchemaDefinition = {
    fullName: {
      type: String,
      required: [true, fullNameRequiredMessage],
      trim: true,
    },
    phone: {
      type: String,
      required: requirePhone ? [true, phoneRequiredMessage] : false,
      trim: true,
    },
    addressLine1: {
      type: String,
      required: [true, 'Address line 1 is required'],
      trim: true,
    },
    addressLine2: {
      type: String,
      trim: true,
    },
    city: {
      type: String,
      required: [true, 'City is required'],
      trim: true,
    },
    state: {
      type: String,
      required: requireState ? [true, 'State/Province is required'] : false,
      trim: true,
    },
    postalCode: {
      type: String,
      required: requirePostalCode ? [true, 'Postal code is required'] : false,
      trim: true,
    },
    country: {
      type: String,
      required: [true, 'Country is required'],
      trim: true,
      default: defaultCountry,
    },
  };

  if (includeLabel) {
    definition.label = {
      type: String,
      required: [true, 'Address label is required'],
      trim: true,
      default: 'Home',
    };
  }

  if (includeIsDefault) {
    definition.isDefault = {
      type: Boolean,
      default: false,
    };
  }

  return definition;
}

/**
 * Reusable schema fields for product items with variant options (Cart & Order items)
 */
export const commonItemVariantFields: SchemaDefinition = {
  quantity: {
    type: Number,
    required: [true, 'Quantity is required'],
    min: [1, 'Quantity must be at least 1'],
  },
  size: {
    type: String,
    trim: true,
  },
  color: {
    type: String,
    trim: true,
  },
};
