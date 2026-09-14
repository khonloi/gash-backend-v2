import { Query } from 'mongoose';
import { QueryString } from '../types/index.js';

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
        ...(typeof queryObj.price === 'object' ? queryObj.price : {}),
        ...priceFilter,
      };
    }

    // Advanced filtering: replace gte, gt, lte, lt, in, ne with $gte, $gt, etc.
    let queryStr = JSON.stringify(queryObj);
    queryStr = queryStr.replace(
      /\b(gte|gt|lte|lt|in|ne)\b/g,
      (match) => `$${match}`
    );

    this.mongooseQuery = this.mongooseQuery.find(JSON.parse(queryStr));
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
   * Sort results by field(s)
   */
  sort(): this {
    if (this.queryString.sort) {
      const sortBy = String(this.queryString.sort).split(',').join(' ');
      this.mongooseQuery = this.mongooseQuery.sort(sortBy);
    } else {
      this.mongooseQuery = this.mongooseQuery.sort('-createdAt');
    }
    return this;
  }

  /**
   * Project specific fields in result
   */
  limitFields(): this {
    if (this.queryString.fields) {
      const fields = String(this.queryString.fields).split(',').join(' ');
      this.mongooseQuery = this.mongooseQuery.select(fields);
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
