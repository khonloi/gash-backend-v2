import { Query } from 'mongoose';
import { PaginatedResult, QueryString } from '../types/index.js';

export class APIFeatures<T> {
  public mongooseQuery: Query<T[], T>;
  public queryString: QueryString;
  public pagination = {
    page: 1,
    limit: 10,
    totalPages: 1,
    totalResults: 0,
  };

  constructor(mongooseQuery: Query<T[], T>, queryString: QueryString) {
    this.mongooseQuery = mongooseQuery;
    this.queryString = queryString;
  }

  /**
   * Filter documents using query params and operators (gte, gt, lte, lt, in, ne)
   */
  filter(): this {
    const queryObj = { ...this.queryString };
    const excludedFields = [
      'page',
      'sort',
      'limit',
      'fields',
      'keyword',
      'minPrice',
      'maxPrice',
    ];
    excludedFields.forEach((field) => delete queryObj[field]);

    // Handle minPrice and maxPrice shortcuts
    if (
      this.queryString.minPrice !== undefined ||
      this.queryString.maxPrice !== undefined
    ) {
      const priceFilter: Record<string, number> = {};
      if (this.queryString.minPrice !== undefined) {
        priceFilter.gte = Number(this.queryString.minPrice);
      }
      if (this.queryString.maxPrice !== undefined) {
        priceFilter.lte = Number(this.queryString.maxPrice);
      }
      queryObj.price = {
        ...(typeof queryObj.price === 'object' && queryObj.price !== null
          ? (queryObj.price as Record<string, unknown>)
          : {}),
        ...priceFilter,
      };
    }

    // Safely transform comparison operators only on object keys without global regex string replacement
    const validOperators = new Set(['gte', 'gt', 'lte', 'lt', 'in', 'ne']);
    const formattedQuery: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(queryObj)) {
      if (
        value !== null &&
        typeof value === 'object' &&
        !Array.isArray(value)
      ) {
        const opObj: Record<string, unknown> = {};
        for (const [opKey, opVal] of Object.entries(
          value as Record<string, unknown>
        )) {
          if (validOperators.has(opKey)) {
            opObj[`$${opKey}`] = opVal;
          } else if (
            opKey.startsWith('$') &&
            validOperators.has(opKey.slice(1))
          ) {
            opObj[opKey] = opVal;
          } else {
            opObj[opKey] = opVal;
          }
        }
        formattedQuery[key] = opObj;
      } else {
        formattedQuery[key] = value;
      }
    }

    this.mongooseQuery = this.mongooseQuery.find(
      formattedQuery as unknown as Parameters<Query<T[], T>['find']>[0]
    );
    return this;
  }

  /**
   * Full-text search or keyword regex search
   */
  search(): this {
    if (this.queryString.keyword) {
      const keyword = String(this.queryString.keyword).trim();
      if (keyword) {
        this.mongooseQuery = this.mongooseQuery.find({
          $text: { $search: keyword },
        });
      }
    }
    return this;
  }

  /**
   * Sort results by field(s) safely
   */
  sort(): this {
    if (this.queryString.sort) {
      const sortBy = String(this.queryString.sort)
        .split(',')
        .map((s) => s.trim())
        .filter((s) => /^-?[a-zA-Z0-9_.]+$/.test(s))
        .join(' ');

      this.mongooseQuery = this.mongooseQuery.sort(sortBy || '-createdAt');
    } else {
      this.mongooseQuery = this.mongooseQuery.sort('-createdAt');
    }
    return this;
  }

  /**
   * Project specific fields in result (disallows '+' prefix to prevent overriding select: false)
   */
  limitFields(): this {
    if (this.queryString.fields) {
      const fields = String(this.queryString.fields)
        .split(',')
        .map((f) => f.trim())
        .filter((f) => f.length > 0 && !f.startsWith('+'))
        .join(' ');

      if (fields) {
        this.mongooseQuery = this.mongooseQuery.select(fields);
      } else {
        this.mongooseQuery = this.mongooseQuery.select('-__v');
      }
    } else {
      this.mongooseQuery = this.mongooseQuery.select('-__v');
    }
    return this;
  }

  /**
   * Paginate query results and compute pagination metadata
   */
  paginate(totalResults: number): this {
    const page = Math.max(1, Number(this.queryString.page) || 1);
    const limit = Math.max(
      1,
      Math.min(100, Number(this.queryString.limit) || 10)
    );
    const skip = (page - 1) * limit;

    this.mongooseQuery = this.mongooseQuery.skip(skip).limit(limit);

    this.pagination = {
      page,
      limit,
      totalPages: Math.ceil(totalResults / limit) || 1,
      totalResults,
    };

    return this;
  }
}

export interface PaginateOptions {
  search?: boolean;
  populate?: string | { path: string; select?: string };
}

/**
 * Executes a standard filtered, optionally searched, sorted, and paginated query.
 */
export async function paginateQuery<T>(
  createQuery: () => Query<T[], T>,
  queryString: QueryString,
  options: PaginateOptions = { search: true }
): Promise<PaginatedResult<T>> {
  const countFeatures = new APIFeatures(createQuery(), queryString).filter();
  if (options.search) {
    countFeatures.search();
  }
  const totalResults = await countFeatures.mongooseQuery.countDocuments();

  let dataQuery = createQuery();
  if (options.populate) {
    if (typeof options.populate === 'string') {
      dataQuery = dataQuery.populate(options.populate);
    } else {
      dataQuery = dataQuery.populate(
        options.populate.path,
        options.populate.select
      );
    }
  }

  const features = new APIFeatures(dataQuery, queryString).filter();
  if (options.search) {
    features.search();
  }
  features.sort().limitFields().paginate(totalResults);

  const data = await features.mongooseQuery;

  return {
    data,
    ...features.pagination,
  };
}
