# GASH Backend (v2)

[![Node.js Version](https://img.shields.io/badge/node-%3E%3D20.x-brightgreen.svg?style=flat-square&logo=node.js)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/typescript-v5.9-blue.svg?style=flat-square&logo=typescript)](https://www.typescriptlang.org/)
[![Express](https://img.shields.io/badge/express-v5.2-black.svg?style=flat-square&logo=express)](https://expressjs.com/)
[![MongoDB](https://img.shields.io/badge/database-mongodb%20%2F%20mongoose%209-green.svg?style=flat-square&logo=mongodb)](https://www.mongodb.com/)
[![License: ISC](https://img.shields.io/badge/License-ISC-yellow.svg?style=flat-square)](https://opensource.org/licenses/ISC)
[![Code Style: Prettier](https://img.shields.io/badge/code_style-prettier-ff69b4.svg?style=flat-square&logo=prettier)](https://prettier.io)
[![Linter: ESLint](https://img.shields.io/badge/linter-eslint%209-4B32C3.svg?style=flat-square&logo=eslint)](https://eslint.org)

An enterprise-grade, production-ready, industry-standard RESTful API backend engineered for modern e-commerce platforms. Built with **Node.js**, **Express 5 (ESM)**, **TypeScript** in strict mode, and **MongoDB / Mongoose 9**.

---

## Table of Contents

- [Architectural Highlights](#architectural-highlights)
- [Tech Stack](#tech-stack)
- [Project Directory Structure](#project-directory-structure)
- [Prerequisites](#prerequisites)
- [Installation & Getting Started](#installation--getting-started)
- [Environment Configuration](#environment-configuration)
- [Available Scripts](#available-scripts)
- [Security & Authentication Engine](#security--authentication-engine)
  - [Dual-Token Rotation & Reuse Detection](#dual-token-rotation--reuse-detection)
  - [Role-Based Access Control (RBAC) Matrix](#role-based-access-control-rbac-matrix)
  - [Defense-in-Depth Security Pipeline](#defense-in-depth-security-pipeline)
- [API Conventions & Querying](#api-conventions--querying)
  - [Standard Response Envelope](#standard-response-envelope)
  - [Error Response Envelope](#error-response-envelope)
  - [Advanced Filtering, Sorting & Pagination (APIFeatures)](#advanced-filtering-sorting--pagination-apifeatures)
- [API Reference](#api-reference)
  - [1. Authentication (`/api/v1/auth`)](#1-authentication-apiv1auth)
  - [2. User Profile & Account Management (`/api/v1/users`)](#2-user-profile--account-management-apiv1users)
  - [3. Address Management (`/api/v1/users/me/addresses`)](#3-address-management-apiv1usersmeaddresses)
  - [4. Admin User Management (`/api/v1/users`)](#4-admin-user-management-apiv1users)
  - [5. Product Catalog & Inventory (`/api/v1/products`)](#5-product-catalog--inventory-apiv1products)
  - [6. System Health (`/api/v1/health`)](#6-system-health-apiv1health)
- [Error Handling & Observability](#error-handling--observability)
- [Testing & Quality Assurance](#testing--quality-assurance)
- [Production Deployment & Process Management](#production-deployment--process-management)
- [License](#license)

---

## Architectural Highlights

- **Pure TypeScript & Modern ESM**: Developed using Node.js native ECMAScript Modules (`NodeNext` resolution) with zero compilation compromises and full type-safety.
- **Express 5 Native**: Leverages Express 5 with improved asynchronous handling, native promise routing, and modernized middleware chaining.
- **Dual-Token Authentication with Token Rotation**:
  - Stateless, short-lived Access Tokens (15 min) for lightning-fast request authorization.
  - Stateful, rotating Refresh Tokens (7 days) with cryptographically unique identifiers (`jti`) and strict **token reuse detection** (compromised tokens trigger an immediate global session revocation).
  - Maximum concurrent session enforcement (FIFO capping at 10 active devices per account).
- **Comprehensive E-Commerce Product Engine**:
  - Full product lifecycle with auto-slugification, SKU enforcement, category/tag taxonomies, and multi-tier pricing with discount support.
  - Dedicated atomic inventory adjustment (`/stock`) with out-of-stock and low-stock flagging.
  - Real-time aggregation pipeline (`/stats`) providing inventory valuation, category distributions, and rating metrics.
- **Granular Role-Based Access Control (RBAC)**:
  - Declarative route guards for `customer`, `seller`, and `admin` roles.
  - Resource-level ownership checks preventing unauthorized seller tampering.
- **Production-Grade Data Protection & Resilience**:
  - Protection against NoSQL Injection, HTTP Parameter Pollution (HPP), and Cross-Site Scripting (Helmet HTTP headers, strict CORS).
  - Multi-tier rate limiting: global API throttling plus targeted brute-force protection for authentication routes (`/login`, `/register`).
  - Graceful shutdown orchestration for `SIGTERM`, `SIGINT`, unhandled rejections, and uncaught exceptions.

---

## Tech Stack

| Domain                  | Technology / Library                                                                                                                                                                               | Purpose                                                         |
| :---------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :-------------------------------------------------------------- |
| **Runtime**             | [Node.js](https://nodejs.org/) (>= 20.x)                                                                                                                                                           | High-performance asynchronous V8 runtime                        |
| **Language**            | [TypeScript](https://www.typescriptlang.org/) (5.9+)                                                                                                                                               | Static typing, maintainability, and IntelliSense                |
| **Framework**           | [Express](https://expressjs.com/) (5.2+)                                                                                                                                                           | Fast, unopinionated web framework                               |
| **Database**            | [MongoDB](https://www.mongodb.com/) & [Mongoose](https://mongoosejs.com/) (9.x)                                                                                                                    | Document-based persistence & schema modelling                   |
| **Validation**          | [Zod](https://zod.dev/) (4.x)                                                                                                                                                                      | Runtime request payload validation with strict typing           |
| **Auth & Cryptography** | [jsonwebtoken](https://github.com/auth0/node-jsonwebtoken), [bcryptjs](https://github.com/dcodeIO/bcrypt.js)                                                                                       | JWT dual-token implementation & salt-hashed passwords           |
| **Security**            | `helmet`, `cors`, `express-rate-limit`, `hpp`, custom NoSQL sanitizer                                                                                                                              | Defense-in-depth protection suite                               |
| **Logging**             | [Winston](https://github.com/winstonjs/winston) & [Morgan](https://github.com/expressjs/morgan)                                                                                                    | Dual structured file/console logging and HTTP request telemetry |
| **Testing**             | [Jest](https://jestjs.io/), [Supertest](https://github.com/ladjs/supertest), [mongodb-memory-server](https://github.com/nodkz/mongodb-memory-server)                                               | Automated integration & unit testing in isolated in-memory DB   |
| **Tooling & Hooks**     | [pnpm](https://pnpm.io/), [ESLint 9](https://eslint.org/), [Prettier](https://prettier.io/), [Husky](https://typicode.github.io/husky/), [lint-staged](https://github.com/lint-staged/lint-staged) | Git-hook enforced code formatting and lint verification         |

---

## Project Directory Structure

```text
gash-backend-v2/
├── .husky/                   # Git lifecycle hooks (pre-commit, lint-staged)
├── dist/                     # Compiled JavaScript output for production runtime
├── src/
│   ├── config/               # Infrastructure & client configurations
│   │   ├── db.ts             # Mongoose connection with resilient fallback
│   │   └── logger.ts         # Winston structured logging pipeline
│   ├── controllers/          # HTTP request handlers & presentation layer
│   │   ├── authController.ts # Register, login, refresh, password recovery, email verification
│   │   ├── healthController.ts # System healthcheck endpoint
│   │   ├── productController.ts# Product catalog, search, stock adjustments, aggregation
│   │   └── userController.ts # User profile, addresses, admin account operations
│   ├── middlewares/          # Express middleware pipeline
│   │   ├── auth.ts           # Bearer JWT verification (protect) and RBAC guard (restrictTo)
│   │   ├── errorHandler.ts   # Centralized error handler (operational vs. programming errors)
│   │   ├── mongoSanitize.ts  # Express 5-compatible NoSQL query injection prevention
│   │   └── validate.ts       # Generic Zod middleware for params, query, and body
│   ├── models/               # Mongoose schemas, hooks, methods, and virtuals
│   │   ├── Product.ts        # Product schema with pre-save slugify and virtual discounts
│   │   └── User.ts           # User schema with bcrypt hooks, tokens, and address subdocs
│   ├── routes/               # API route definitions & middleware wiring
│   │   ├── authRoutes.ts     # /api/v1/auth routes
│   │   ├── productRoutes.ts  # /api/v1/products routes
│   │   └── userRoutes.ts     # /api/v1/users routes
│   ├── services/             # Core business logic layer (controller-decoupled)
│   │   ├── authService.ts    # Authentication workflows, token rotation, session eviction
│   │   ├── productService.ts # Product CRUD, stock adjustment logic, aggregation queries
│   │   └── userService.ts    # Profile management, address logic, admin operations
│   ├── types/                # Ambient and explicit TypeScript interfaces / models
│   │   ├── index.ts          # Central type exports
│   │   ├── product.ts        # IProduct, ProductStatus, inventory types
│   │   └── user.ts           # IUser, IAddress, IRefreshToken, UserRole
│   ├── utils/                # Reusable utilities & helpers
│   │   ├── apiFeatures.ts    # Filter, sort, limit, search, and pagination engine
│   │   ├── AppError.ts       # Operational error subclass with HTTP status codes
│   │   ├── catchAsync.ts     # Controller wrapper eliminating redundant try/catch blocks
│   │   ├── crypto.ts         # Crypto-secure random token generation and SHA-256 hashing
│   │   └── jwt.ts            # JWT signing, verification, and decoding helpers
│   ├── validations/          # Zod validation schemas
│   │   ├── authValidation.ts # Schemas for register, login, refresh, password reset
│   │   ├── productValidation.ts # Schemas for product creation, updates, and stock
│   │   └── userValidation.ts # Schemas for profile update, addresses, user queries
│   ├── app.ts                # Express application configuration & middleware mount
│   └── server.ts             # HTTP server entrypoint, listeners, and graceful shutdown
├── tests/                    # Automated test suites with mongodb-memory-server
│   ├── app.test.ts           # Health check and root route tests
│   ├── auth.test.ts          # Registration, login, token rotation, reuse detection tests
│   ├── product.test.ts       # Product CRUD, RBAC, search, filter, stock tests
│   └── user.test.ts          # Profile, password change, address subdocs, admin tests
├── .env.example              # Environment variables template
├── eslint.config.js          # ESLint 9 Flat Configuration
├── jest.config.js            # Jest ESM configuration with ts-jest
├── package.json              # Package manifest, scripts, and dependencies
├── tsconfig.json             # TypeScript base configuration
├── tsconfig.build.json       # Production build TypeScript configuration
└── README.md                 # Complete project documentation
```

---

## Prerequisites

Ensure your development environment meets the following specifications:

- **Node.js**: `v20.x` or higher (`v22.x` recommended)
- **Package Manager**: [pnpm](https://pnpm.io/) (`v9.x` or `v12.x`)
- **Database**: [MongoDB](https://www.mongodb.com/) (`v6.x` or `v7.x`) or a free [MongoDB Atlas](https://www.mongodb.com/atlas) cluster.
  _(Note: The server includes a fallback mode that allows it to run without MongoDB configured for health checks)._

---

## Installation & Getting Started

### 1. Clone the Repository

```bash
git clone https://github.com/your-username/gash-backend-v2.git
cd gash-backend-v2
```

### 2. Install Dependencies

```bash
pnpm install
```

### 3. Setup Environment Variables

Copy `.env.example` to create your local `.env` file:

```bash
cp .env.example .env
```

Review and configure your parameters (see [Environment Configuration](#environment-configuration)).

### 4. Run Development Server

```bash
pnpm run dev
```

The server will launch with `tsx watch` on `http://localhost:5000` with hot-reloading enabled.

---

## Environment Configuration

| Variable                 | Required |    Default    | Description                                               | Example                                    |
| :----------------------- | :------: | :-----------: | :-------------------------------------------------------- | :----------------------------------------- |
| `NODE_ENV`               |   Yes    | `development` | Runtime environment (`development`, `production`, `test`) | `development`                              |
| `PORT`                   |    No    |    `5000`     | Port on which the Express server listens                  | `5000`                                     |
| `MONGO_URI`              |   Yes    |       —       | MongoDB connection string                                 | `mongodb://localhost:27017/gash-ecommerce` |
| `JWT_SECRET`             |   Yes    |       —       | Secret key used to sign and verify Access Tokens          | `super_secret_jwt_access_key_123!`         |
| `JWT_ACCESS_EXPIRES_IN`  |    No    |     `15m`     | Lifetime duration for access tokens                       | `15m`                                      |
| `JWT_REFRESH_SECRET`     |    No    | `JWT_SECRET`  | Secret key used to sign Refresh Tokens                    | `super_secret_jwt_refresh_key_456!`        |
| `JWT_REFRESH_EXPIRES_IN` |    No    |     `7d`      | Lifetime duration for refresh tokens                      | `7d`                                       |
| `BCRYPT_COST`            |    No    |     `12`      | Bcrypt hashing cost salt rounds (10–14)                   | `12`                                       |
| `CORS_ORIGIN`            |    No    |      `*`      | Whitelisted frontend origin URL for CORS                  | `http://localhost:3000`                    |

---

## Available Scripts

| Script      | Command            | Purpose                                                                 |
| :---------- | :----------------- | :---------------------------------------------------------------------- |
| **dev**     | `pnpm run dev`     | Starts server in watch mode using `tsx watch` for rapid development.    |
| **build**   | `pnpm run build`   | Compiles TypeScript source files into the production `dist/` directory. |
| **start**   | `pnpm run start`   | Runs the compiled production server from `dist/server.js`.              |
| **test**    | `pnpm run test`    | Executes the complete Jest test suite in an isolated in-memory DB.      |
| **lint**    | `pnpm run lint`    | Runs ESLint 9 to verify code standards across TypeScript files.         |
| **format**  | `pnpm run format`  | Formats all code according to project Prettier guidelines.              |
| **prepare** | `pnpm run prepare` | Initializes Husky Git hook triggers locally.                            |

---

## Security & Authentication Engine

### Dual-Token Rotation & Reuse Detection

The system implements the **OAuth 2.0 / IETF RFC 6749** recommended refresh token rotation flow with automatic breach detection:

```
+----------+                                                     +---------------+
|  Client  | --- (1) POST /api/v1/auth/login ------------------> |  Auth Server  |
|          | <--- (2) Access Token (15m) + Refresh Token (7d) -- | (Stores in DB)|
|          |                                                     +---------------+
|          | --- (3) Request with Access Token (Bearer) -------> | Protected API |
|          |                                                     +---------------+
|          | --- (4) POST /api/v1/auth/refresh-token ----------> |  Auth Server  |
|          |         [Sends Current Refresh Token]               |               |
|          |                                                     | - Invalidates |
|          |                                                     |   old token   |
|          | <--- (5) Issues New Access + New Refresh Token ---- | - Saves new   |
+----------+                                                     +---------------+
                                   |
                  [ATTACK SCENARIO: Token Reuse Detected]
                                   |
           An attacker or client presents a revoked/old token
                                   v
             System detects breach -> Invalidates ALL active
               sessions for that user account immediately!
```

1. **Short-Lived Access Tokens**: Signed with `JWT_SECRET`, containing user ID and role claims, expiring in 15 minutes.
2. **Rotating Refresh Tokens**: Each refresh request atomically revokes the presented refresh token and issues a fresh token pair.
3. **Breach (Reuse) Detection**: If an expired, stolen, or previously used refresh token is presented, the server assumes token theft and **purges all active refresh tokens** for that user, locking out both the legitimate user and the attacker.
4. **Session Limiting**: Users can maintain a maximum of 10 concurrent device sessions. New sessions automatically evict the oldest token (FIFO).
5. **Password Change Token Invalidation**: The `changedPasswordAfter` mechanism rejects any access tokens issued before a user's `passwordChangedAt` timestamp.

---

### Role-Based Access Control (RBAC) Matrix

| Endpoint Group                             | Public | `customer` |  `seller`   |  `admin`  |
| :----------------------------------------- | :----: | :--------: | :---------: | :-------: |
| **Browse / Search Products**               |  Yes   |    Yes     |     Yes     |    Yes    |
| **View Product Statistics (`/stats`)**     |  Yes   |    Yes     |     Yes     |    Yes    |
| **Register, Login, Forgot Password**       |  Yes   |    Yes     |     Yes     |    Yes    |
| **Manage Own Profile (`/me`)**             |   No   |    Yes     |     Yes     |    Yes    |
| **Manage Own Addresses (`/me/addresses`)** |   No   |    Yes     |     Yes     |    Yes    |
| **Create New Product**                     |   No   |     No     |     Yes     |    Yes    |
| **Update Own Product / Adjust Stock**      |   No   |     No     | Yes (Owner) | Yes (All) |
| **Delete Product**                         |   No   |     No     |     No      |    Yes    |
| **Manage Users & Assign Roles**            |   No   |     No     |     No      |    Yes    |
| **Hard Delete User Account**               |   No   |     No     |     No      |    Yes    |

---

### Defense-in-Depth Security Pipeline

1. **Helmet**: Configures hardened HTTP response headers (HSTS, Content Security Policy, X-Content-Type-Options, etc.).
2. **Custom NoSQL Injection Sanitizer**: Recursively strips `$` prefix characters and dot-notated operator keys from incoming `req.body`, `req.query`, and `req.params`.
3. **HTTP Parameter Pollution (HPP)**: Prevents query parameter manipulation while selectively whitelisting legitimate multi-value filter keys (`price`, `category`, `tags`, `brand`, `role`).
4. **Targeted Brute-Force Rate Limiting**:
   - `/api/*`: 1,000 requests per hour per IP.
   - `/api/v1/auth/login` & `/register`: Strict 20 attempts per 15 minutes per IP.
5. **Body Parser Constraints**: Limits incoming JSON and URL-encoded request payloads to 10 KB to defend against memory exhaustion attacks.
6. **Bcrypt Password Hashing**: Passwords are encrypted with a configurable salt cost (default: 12 rounds) and are automatically hidden (`select: false`) on queries.
7. **User Enumeration Prevention**: Password recovery (`/forgot-password`) always returns a generic success response regardless of whether the email is registered.

---

## API Conventions & Querying

### Standard Response Envelope

All successful responses return a predictable JSON envelope:

```json
{
  "status": "success",
  "results": 1,
  "data": {
    "product": { ... }
  }
}
```

For paginated lists:

```json
{
  "status": "success",
  "results": 10,
  "pagination": {
    "page": 1,
    "limit": 10,
    "totalPages": 5,
    "totalResults": 48
  },
  "data": {
    "products": [ ... ]
  }
}
```

---

### Error Response Envelope

Operational errors generated by the application conform to the standard error structure:

```json
{
  "status": "fail",
  "message": "Current password is incorrect"
}
```

In `development` mode, responses also include the detailed error object and stack trace.

---

### Advanced Filtering, Sorting & Pagination (APIFeatures)

The product and user listing endpoints are powered by an advanced query engine (`APIFeatures`):

#### 1. Range & Comparison Filtering

Use MongoDB comparison operators (`gte`, `gt`, `lte`, `lt`, `in`) using bracket notation:

```http
GET /api/v1/products?price[gte]=50&price[lte]=200&ratingsAverage[gte]=4.5
```

#### 2. Sorting

Sort by any field ascending or descending (prefix with `-`):

```http
GET /api/v1/products?sort=-ratingsAverage,-price
```

#### 3. Field Projection / Limiting

Retrieve only the fields required by the frontend client:

```http
GET /api/v1/products?fields=title,price,ratingsAverage,images
```

#### 4. Pagination

Control page number and page size:

```http
GET /api/v1/products?page=2&limit=15
```

#### 5. Full-Text Search

Perform case-insensitive fuzzy keyword searches:

```http
GET /api/v1/products?search=wireless+headphones
```

---

## API Reference

### 1. Authentication (`/api/v1/auth`)

| Method  | Endpoint                             |  Access   | Description                                    |
| :------ | :----------------------------------- | :-------: | :--------------------------------------------- |
| `POST`  | `/api/v1/auth/register`              |  Public   | Register a new user account                    |
| `POST`  | `/api/v1/auth/login`                 |  Public   | Authenticate user and receive token pair       |
| `POST`  | `/api/v1/auth/refresh-token`         |  Public   | Rotate refresh token and obtain new token pair |
| `POST`  | `/api/v1/auth/logout`                | Protected | Invalidate current refresh token session       |
| `POST`  | `/api/v1/auth/logout-all`            | Protected | Invalidate all sessions across all devices     |
| `POST`  | `/api/v1/auth/forgot-password`       |  Public   | Generate and send password reset token         |
| `PATCH` | `/api/v1/auth/reset-password/:token` |  Public   | Reset password using one-time token            |
| `GET`   | `/api/v1/auth/verify-email/:token`   |  Public   | Verify email address using token               |

#### Register

```http
POST /api/v1/auth/register
Content-Type: application/json

{
  "firstName": "Jane",
  "lastName": "Doe",
  "email": "jane.doe@example.com",
  "password": "Password123!",
  "passwordConfirm": "Password123!"
}
```

#### Login

```http
POST /api/v1/auth/login
Content-Type: application/json

{
  "email": "jane.doe@example.com",
  "password": "Password123!"
}
```

**Response (200 OK)**:

```json
{
  "status": "success",
  "data": {
    "user": {
      "_id": "66e57bb3e24b4c732c58a101",
      "firstName": "Jane",
      "lastName": "Doe",
      "email": "jane.doe@example.com",
      "role": "customer",
      "isEmailVerified": false,
      "isActive": true
    },
    "tokens": {
      "accessToken": "eyJhbGciOiJIUzI1Ni...",
      "refreshToken": "eyJhbGciOiJIUzI1Ni..."
    }
  }
}
```

#### Refresh Token

```http
POST /api/v1/auth/refresh-token
Content-Type: application/json

{
  "refreshToken": "eyJhbGciOiJIUzI1Ni..."
}
```

---

### 2. User Profile & Account Management (`/api/v1/users`)

_All profile endpoints require `Authorization: Bearer <accessToken>`._

| Method   | Endpoint                    |  Access   | Description                                                         |
| :------- | :-------------------------- | :-------: | :------------------------------------------------------------------ |
| `GET`    | `/api/v1/users/me`          | Protected | Retrieve current authenticated user profile                         |
| `PATCH`  | `/api/v1/users/me`          | Protected | Update profile fields (`firstName`, `lastName`, `phone`, `avatar`)  |
| `DELETE` | `/api/v1/users/me`          | Protected | Soft-delete current account (`isActive: false`) and revoke sessions |
| `PATCH`  | `/api/v1/users/me/password` | Protected | Change password with current password verification                  |

#### Update Profile

```http
PATCH /api/v1/users/me
Authorization: Bearer <accessToken>
Content-Type: application/json

{
  "firstName": "Jane",
  "lastName": "Smith",
  "phone": "+1-555-0199"
}
```

#### Change Password

```http
PATCH /api/v1/users/me/password
Authorization: Bearer <accessToken>
Content-Type: application/json

{
  "currentPassword": "Password123!",
  "newPassword": "NewSecurePassword456!",
  "newPasswordConfirm": "NewSecurePassword456!"
}
```

---

### 3. Address Management (`/api/v1/users/me/addresses`)

_Manage multiple shipping/billing addresses with automated default handling._

| Method   | Endpoint                                |  Access   | Description                                        |
| :------- | :-------------------------------------- | :-------: | :------------------------------------------------- |
| `GET`    | `/api/v1/users/me/addresses`            | Protected | List all stored addresses                          |
| `POST`   | `/api/v1/users/me/addresses`            | Protected | Add a new address                                  |
| `PATCH`  | `/api/v1/users/me/addresses/:addressId` | Protected | Update an existing address                         |
| `DELETE` | `/api/v1/users/me/addresses/:addressId` | Protected | Delete an address (auto-promotes fallback default) |

#### Add Address

```http
POST /api/v1/users/me/addresses
Authorization: Bearer <accessToken>
Content-Type: application/json

{
  "label": "Home",
  "fullName": "Jane Doe",
  "addressLine1": "742 Evergreen Terrace",
  "city": "Springfield",
  "state": "IL",
  "postalCode": "62704",
  "country": "US",
  "isDefault": true
}
```

---

### 4. Admin User Management (`/api/v1/users`)

_Restricted exclusively to users with `admin` role._

| Method   | Endpoint                 | Access | Description                                             |
| :------- | :----------------------- | :----: | :------------------------------------------------------ |
| `GET`    | `/api/v1/users`          | Admin  | Query, filter, and paginate through all users           |
| `GET`    | `/api/v1/users/:id`      | Admin  | Retrieve user details by ID                             |
| `PATCH`  | `/api/v1/users/:id/role` | Admin  | Update user access role (`customer`, `seller`, `admin`) |
| `DELETE` | `/api/v1/users/:id`      | Admin  | Permanently hard-delete a user record                   |

#### Update Role

```http
PATCH /api/v1/users/66e57bb3e24b4c732c58a101/role
Authorization: Bearer <adminToken>
Content-Type: application/json

{
  "role": "seller"
}
```

---

### 5. Product Catalog & Inventory (`/api/v1/products`)

| Method   | Endpoint                      |     Access     | Description                                  |
| :------- | :---------------------------- | :------------: | :------------------------------------------- |
| `GET`    | `/api/v1/products`            |     Public     | Query, filter, search, and paginate products |
| `GET`    | `/api/v1/products/:id`        |     Public     | Get single product by MongoDB ObjectId       |
| `GET`    | `/api/v1/products/slug/:slug` |     Public     | Get single product by URL-friendly slug      |
| `GET`    | `/api/v1/products/featured`   |     Public     | Retrieve curated featured products           |
| `GET`    | `/api/v1/products/stats`      |     Public     | Product catalog statistics and aggregations  |
| `POST`   | `/api/v1/products`            | Seller / Admin | Create a new product                         |
| `PATCH`  | `/api/v1/products/:id`        | Seller / Admin | Update product details (ownership verified)  |
| `PATCH`  | `/api/v1/products/:id/stock`  | Seller / Admin | Adjust inventory level                       |
| `DELETE` | `/api/v1/products/:id`        |     Admin      | Permanently delete a product                 |

#### Create Product

```http
POST /api/v1/products
Authorization: Bearer <sellerOrAdminToken>
Content-Type: application/json

{
  "title": "Noise-Cancelling Wireless Headphones",
  "description": "Premium over-ear wireless headphones with active noise cancellation and 30-hour battery life.",
  "price": 249.99,
  "compareAtPrice": 299.99,
  "category": "Electronics",
  "subcategory": "Audio",
  "brand": "AcousticPro",
  "sku": "AP-WH-001",
  "stock": 50,
  "tags": ["audio", "wireless", "bluetooth"],
  "images": [
    {
      "url": "https://cdn.example.com/products/headphones-1.jpg",
      "alt": "Side profile of headphones",
      "isPrimary": true
    }
  ]
}
```

#### Adjust Stock

```http
PATCH /api/v1/products/66e57bb3e24b4c732c58a202/stock
Authorization: Bearer <sellerOrAdminToken>
Content-Type: application/json

{
  "quantity": 25,
  "operation": "increment"
}
```

_(Supports operations: `"increment"`, `"decrement"`, or `"set"`)_.

---

### 6. System Health (`/api/v1/health`)

| Method | Endpoint         | Access | Description                                       |
| :----- | :--------------- | :----: | :------------------------------------------------ |
| `GET`  | `/api/v1/health` | Public | Returns service availability and uptime timestamp |

**Response (200 OK)**:

```json
{
  "status": "success",
  "message": "Server is healthy",
  "timestamp": "2026-09-14T13:03:32.000Z"
}
```

---

## Error Handling & Observability

### Operational Error Handling

Errors are classified into **Operational Errors** (known, expected issues like validation failures, resource not found, or authentication invalidity) handled via `AppError`, and **Programming Errors** (unexpected bugs, syntax issues).

- **Mongoose CastError (Invalid ID)**: Converted to `400 Bad Request` with helpful field information.
- **Mongoose Duplicate Key (11000)**: Converted to `400 Bad Request` citing duplicate field values.
- **Mongoose ValidationError**: Converted to clean `400 Bad Request` detailing all failed field validations.
- **JWT Errors (`JsonWebTokenError`, `TokenExpiredError`)**: Automatically caught and translated to `401 Unauthorized`.
- **Zod Validation Errors**: Handled cleanly by request middleware before reaching controller logic.

### Logging System

Structured logging is managed using [Winston](https://github.com/winstonjs/winston):

- **Console Output**: Formatted with colorization and timestamp for development readability.
- **File Transports**: Automatically writes `error.log` (level: `error`) and `combined.log` (all levels) in production.
- **HTTP Access Logs**: Integrated via `morgan` middleware in development.

---

## Testing & Quality Assurance

The codebase features comprehensive unit and integration test suites executed with [Jest](https://jestjs.io/) and [Supertest](https://github.com/ladjs/supertest). Tests run against an isolated [mongodb-memory-server](https://github.com/nodkz/mongodb-memory-server), ensuring tests never interfere with live or staging data.

```bash
# Execute all test suites
pnpm run test

# Run tests in watch mode
pnpm run test -- --watch

# Run a specific test suite
pnpm run test tests/auth.test.ts
```

### Test Coverage Highlights

- **Auth Suite (`tests/auth.test.ts`)**: Validates user registration, duplicate email rejection, login credentials, refresh token rotation, token reuse breach detection, logout, logout-all, and password reset flows.
- **User Suite (`tests/user.test.ts`)**: Validates profile updates, password changes with session reset, soft deactivation (`isActive: false`), address subdocument lifecycle, and admin user operations.
- **Product Suite (`tests/product.test.ts`)**: Validates CRUD operations, RBAC permissions (`seller`/`admin`), filter comparisons (`gte`, `lte`), pagination, sorting, text search, and stock adjustment atomic operations.
- **App Suite (`tests/app.test.ts`)**: Validates health check endpoints, security headers, and 404 handler for undefined routes.

---

## Production Deployment & Process Management

### 1. Compile TypeScript Code

```bash
pnpm run build
```

This compiles all files from `src/` to `dist/` using `tsconfig.build.json`.

### 2. Verify Linting & Formatting

```bash
pnpm run lint
pnpm run format
```

### 3. Start Production Server

```bash
NODE_ENV=production pnpm run start
```

### Process Management with PM2 (Recommended)

To run the application in a production cluster with zero-downtime reloads:

```bash
# Install PM2 globally
npm install -g pm2

# Start clustered instances
pm2 start dist/server.js --name "gash-backend" -i max

# Monitor instances
pm2 status
pm2 logs gash-backend
```

---

## License

This project is licensed under the [ISC License](LICENSE).
