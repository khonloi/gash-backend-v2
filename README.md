# GASH Backend (v2)

Production-ready, industry-standard MERN e-commerce backend built with **Node.js**, **Express 5**, and **TypeScript**.

---

## Features & Architecture

- **Runtime & Language**: Node.js with TypeScript (`NodeNext` module resolution, strict mode).
- **Web Framework**: Express 5.x with ESM architecture and robust HTTP routing.
- **Database**: MongoDB with Mongoose (graceful optional fallback when `MONGO_URI` is not configured yet).
- **Security Middlewares**:
  - `helmet` — Sets HTTP security headers.
  - `cors` — Cross-Origin Resource Sharing with customizable origins.
  - `express-rate-limit` — Protection against brute-force / DDoS attacks.
  - `hpp` — HTTP Parameter Pollution protection.
  - Custom NoSQL injection sanitization middleware compatible with Express 5 request objects.
- **Error Handling**:
  - Operational vs. programmatic error distinction via custom `AppError` class.
  - Centralized global error-handling middleware.
  - Unhandled rejection and uncaught exception handlers with graceful shutdown (`SIGTERM`, `SIGINT`).
  - `catchAsync` wrapper for clean asynchronous controller routes.
- **Logging**: Structured, environment-aware logging using `winston` and HTTP request logging with `morgan`.
- **Code Quality & Tooling**:
  - Flat ESLint configuration (`typescript-eslint`).
  - Prettier for opinionated code formatting.
  - Husky + lint-staged pre-commit hooks for automated linting and formatting on commit.
  - Jest + Supertest for integration and unit testing.

---

## Project Structure

```text
gash-backend-v2/
├── .husky/              # Git hooks (pre-commit with lint-staged)
├── dist/                # Compiled JavaScript output (git-ignored)
├── src/
│   ├── config/          # Database, logger, and runtime configurations
│   │   ├── db.ts
│   │   └── logger.ts
│   ├── controllers/     # Request handlers / HTTP layer
│   │   └── healthController.ts
│   ├── middlewares/     # Express middlewares (auth, error handler, sanitization)
│   │   ├── errorHandler.ts
│   │   └── mongoSanitize.ts
│   ├── models/          # Mongoose schemas and models
│   ├── routes/          # API route definitions
│   ├── services/        # Business logic layer
│   ├── utils/           # Utilities (AppError, catchAsync)
│   │   ├── AppError.ts
│   │   └── catchAsync.ts
│   ├── app.ts           # Express app setup and middleware pipeline
│   └── server.ts        # Server entrypoint and lifecycle handling
├── tests/               # Unit and integration test suites
│   └── app.test.ts
├── .env.example         # Template for environment variables
├── eslint.config.js     # Flat ESLint configuration
├── jest.config.js       # Jest ESM configuration
├── package.json         # Dependencies, scripts, and package metadata
├── tsconfig.json        # TypeScript compiler options
└── README.md
```

---

## Prerequisites

- [Node.js](https://nodejs.org/) (>= 18.x or >= 20.x recommended)
- [pnpm](https://pnpm.io/) (>= 9.x or 12.x)
- [MongoDB](https://www.mongodb.com/) (local instance or MongoDB Atlas cluster — optional for initial healthcheck setup)

---

## Getting Started

### 1. Clone & Install Dependencies

```bash
git clone <repo-url>
cd gash-backend-v2
pnpm install
```

### 2. Configure Environment Variables

Copy `.env.example` to `.env` and fill in the values:

```bash
cp .env.example .env
```

Example `.env` settings:

```env
NODE_ENV=development
PORT=5000
MONGO_URI=mongodb://localhost:27017/gash-backend
CORS_ORIGIN=http://localhost:3000
```

> **Note**: If `MONGO_URI` is not specified, the server will log a warning and continue running in standalone mode (e.g. for health checks and API scaffolding).

### 3. Run the Development Server

```bash
pnpm run dev
```

Uses `tsx watch` to provide fast hot-reloading on changes to TypeScript files in `src/`.

### 4. Build for Production

```bash
pnpm run build
```

Compiles TypeScript code from `src/` to `dist/`.

### 5. Start in Production

```bash
pnpm run start
```

Runs the compiled production server at `dist/server.js`.

---

## Available Scripts

| Script   | Command           | Description                                                      |
| :------- | :---------------- | :--------------------------------------------------------------- |
| `dev`    | `pnpm run dev`    | Runs the server in development mode with `tsx watch` hot-reload. |
| `build`  | `pnpm run build`  | Compiles TypeScript files to the `dist/` directory.              |
| `start`  | `pnpm run start`  | Runs the production build from `dist/server.js`.                 |
| `lint`   | `pnpm run lint`   | Lints TypeScript and JavaScript files with ESLint.               |
| `format` | `pnpm run format` | Formats the codebase using Prettier.                             |
| `test`   | `pnpm run test`   | Runs Jest test suite with ts-jest in ESM mode.                   |

---

## Health Check Endpoint

Once the server is running, you can test it via:

```bash
curl http://localhost:5000/api/v1/health
```

Expected response:

```json
{
  "status": "success",
  "message": "Server is healthy",
  "timestamp": "2026-09-14T..."
}
```

---

## License

ISC
