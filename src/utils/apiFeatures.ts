import { Query } from 'mongoose';
import { PaginatedResult, QueryString } from '../types/index.js';
import { AppError } from './AppError.js';

const DANGEROUS_FILTER_KEYS = new Set([
  '__proto__',
  'constructor',
  'prototype',
]);
const VALID_OPERATORS = new Set(['gte', 'gt', 'lte', 'lt', 'in', 'ne']);

export interface APIFeaturesOptions {
  allowedFilterFields?: readonly string[];
  allowedSortFields?: readonly string[];
  allowedSelectFields?: readonly string[];
  excludedSelectFields?: readonly string[];
  maxPage?: number;
  maxLimit?: number;
}

export class APIFeatures<T> {
  public mongooseQuery: Query<T[], T>;
  public queryString: QueryString;
  private options: APIFeaturesOptions;
  public pagination = {
    page: 1,
    limit: 10,
    totalPages: 1,
    totalResults: 0,
  };

  constructor(
    mongooseQuery: Query<T[], T>,
    queryString: QueryString,
    options: APIFeaturesOptions = {}
  ) {
    this.mongooseQuery = mongooseQuery;
    this.queryString = queryString;
    this.options = options;
  }

  /**
   * Filter documents using query params and operators (gte, gt, lte, lt, in, ne).
   * Enforces optional field allowlists and drops any unsafe operators or dotted/$ keys.
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

    const allowedFilters = this.options.allowedFilterFields
      ? new Set(this.options.allowedFilterFields)
      : null;

    // Handle minPrice and maxPrice shortcuts
    if (
      (this.queryString.minPrice !== undefined ||
        this.queryString.maxPrice !== undefined) &&
      (!allowedFilters || allowedFilters.has('price'))
    ) {
      const priceFilter: Record<string, number> = {};
      if (this.queryString.minPrice !== undefined) {
        const min = Number(this.queryString.minPrice);
        if (!Number.isNaN(min)) {
          priceFilter.gte = min;
        }
      }
      if (this.queryString.maxPrice !== undefined) {
        const max = Number(this.queryString.maxPrice);
        if (!Number.isNaN(max)) {
          priceFilter.lte = max;
        }
      }
      if (Object.keys(priceFilter).length > 0) {
        queryObj.price = {
          ...(typeof queryObj.price === 'object' && queryObj.price !== null
            ? (queryObj.price as Record<string, unknown>)
            : {}),
          ...priceFilter,
        };
      }
    }

    const formattedQuery: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(queryObj)) {
      if (
        value === undefined ||
        DANGEROUS_FILTER_KEYS.has(key) ||
        key.startsWith('$') ||
        key.includes('.')
      ) {
        continue;
      }

      if (allowedFilters && !allowedFilters.has(key)) {
        continue;
      }

      if (
        value !== null &&
        typeof value === 'object' &&
        !Array.isArray(value)
      ) {
        const opObj: Record<string, unknown> = {};
        for (const [opKey, opVal] of Object.entries(
          value as Record<string, unknown>
        )) {
          if (opVal === undefined || DANGEROUS_FILTER_KEYS.has(opKey)) {
            continue;
          }
          if (VALID_OPERATORS.has(opKey)) {
            opObj[`$${opKey}`] = opVal;
          } else if (
            opKey.startsWith('$') &&
            VALID_OPERATORS.has(opKey.slice(1))
          ) {
            opObj[opKey] = opVal;
          }
        }
        if (Object.keys(opObj).length > 0) {
          formattedQuery[key] = opObj;
        }
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
   * Full-text search
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
    const allowedSorts = this.options.allowedSortFields
      ? new Set(this.options.allowedSortFields)
      : null;

    if (this.queryString.sort) {
      const sortBy = String(this.queryString.sort)
        .split(',')
        .map((s) => s.trim())
        .filter((s) => {
          if (!/^-?[a-zA-Z0-9_.]+$/.test(s)) return false;
          if (allowedSorts) {
            const rawField = s.startsWith('-') ? s.slice(1) : s;
            return allowedSorts.has(rawField);
          }
          return true;
        })
        .join(' ');

      this.mongooseQuery = this.mongooseQuery.sort(sortBy || '-createdAt');
    } else {
      this.mongooseQuery = this.mongooseQuery.sort('-createdAt');
    }
    return this;
  }

  /**
   * Project specific fields in result while strictly preventing overrides of select: false fields
   */
  limitFields(): this {
    const allowedSet = this.options.allowedSelectFields
      ? new Set(this.options.allowedSelectFields)
      : null;
    const excludedSet = new Set(this.options.excludedSelectFields ?? []);

    const defaultProjection = allowedSet
      ? Array.from(allowedSet).join(' ')
      : ['-__v', ...Array.from(excludedSet, (f) => `-${f}`)].join(' ');

    if (this.queryString.fields) {
      const tokens = String(this.queryString.fields)
        .split(/[\s,]+/)
        .map((f) => f.trim())
        .filter((f) => f.length > 0 && !f.startsWith('+'));

      const inclusions = tokens.filter((f) => !f.startsWith('-'));
      const exclusions = tokens.filter((f) => f.startsWith('-'));

      if (inclusions.length > 0 && exclusions.length > 0) {
        throw new AppError(
          'Cannot mix inclusion and exclusion fields in projection',
          400
        );
      }

      if (inclusions.length > 0) {
        const safeInclusions = inclusions.filter((f) => {
          if (excludedSet.has(f)) return false;
          if (allowedSet) return allowedSet.has(f);
          return /^[a-zA-Z0-9_.]+$/.test(f);
        });
        this.mongooseQuery = this.mongooseQuery.select(
          safeInclusions.length > 0
            ? safeInclusions.join(' ')
            : defaultProjection
        );
        return this;
      }

      if (exclusions.length > 0) {
        if (allowedSet) {
          const excludedNames = new Set(exclusions.map((f) => f.slice(1)));
          const remaining = Array.from(allowedSet).filter(
            (f) => !excludedNames.has(f)
          );
          this.mongooseQuery = this.mongooseQuery.select(
            remaining.length > 0 ? remaining.join(' ') : defaultProjection
          );
          return this;
        }

        const safeExclusions = exclusions.filter((f) =>
          /^-[a-zA-Z0-9_.]+$/.test(f)
        );
        const combinedExclusions = Array.from(
          new Set([
            ...safeExclusions,
            ...Array.from(excludedSet, (f) => `-${f}`),
          ])
        );
        this.mongooseQuery = this.mongooseQuery.select(
          combinedExclusions.length > 0
            ? combinedExclusions.join(' ')
            : defaultProjection
        );
        return this;
      }
    }

    this.mongooseQuery = this.mongooseQuery.select(defaultProjection);
    return this;
  }

  /**
   * Paginate query results and compute pagination metadata
   */
  paginate(totalResults: number): this {
    const maxPage = this.options.maxPage ?? 1000;
    const maxLimit = this.options.maxLimit ?? 100;

    const rawPage = Math.floor(Number(this.queryString.page));
    const rawLimit = Math.floor(Number(this.queryString.limit));

    const page = Math.min(
      maxPage,
      Math.max(1, Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1)
    );
    const limit = Math.max(
      1,
      Math.min(
        maxLimit,
        Number.isFinite(rawLimit) && rawLimit > 0 ? rawLimit : 10
      )
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

export interface PaginateOptions extends APIFeaturesOptions {
  search?: boolean;
  populate?: string | { path: string; select?: string };
  lockedFilter?: Record<string, unknown>;
}

/**
 * Executes a standard filtered, optionally searched, sorted, and paginated query.
 */
export async function paginateQuery<T>(
  createQuery: () => Query<T[], T>,
  queryString: QueryString,
  options: PaginateOptions = { search: true }
): Promise<PaginatedResult<T>> {
  const effectiveQueryString: QueryString = { ...queryString };
  if (options.lockedFilter) {
    for (const lockedKey of Object.keys(options.lockedFilter)) {
      delete effectiveQueryString[lockedKey];
    }
  }

  const countFeatures = new APIFeatures(
    createQuery(),
    effectiveQueryString,
    options
  ).filter();
  if (options.lockedFilter) {
    countFeatures.mongooseQuery = countFeatures.mongooseQuery.find(
      options.lockedFilter as unknown as Parameters<Query<T[], T>['find']>[0]
    );
  }
  if (options.search) {
    countFeatures.search();
  }

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

  const features = new APIFeatures(
    dataQuery,
    effectiveQueryString,
    options
  ).filter();
  if (options.lockedFilter) {
    features.mongooseQuery = features.mongooseQuery.find(
      options.lockedFilter as unknown as Parameters<Query<T[], T>['find']>[0]
    );
  }
  if (options.search) {
    features.search();
  }
  features.sort().limitFields().paginate(0);

  const [totalResults, data] = await Promise.all([
    countFeatures.mongooseQuery.countDocuments(),
    features.mongooseQuery,
  ]);

  features.pagination.totalResults = totalResults;
  features.pagination.totalPages =
    Math.ceil(totalResults / features.pagination.limit) || 1;

  return {
    data,
    ...features.pagination,
  };
}
