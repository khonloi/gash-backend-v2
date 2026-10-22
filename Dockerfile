# Multi-stage production Dockerfile for gash-backend-v2

# --- Build Stage ---
FROM node:22-alpine AS builder

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@12.4.1 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json tsconfig.build.json ./
RUN pnpm install --frozen-lockfile

COPY src ./src
RUN pnpm build

# --- Production Stage ---
FROM node:22-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=5000

RUN corepack enable && corepack prepare pnpm@12.4.1 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --prod --frozen-lockfile

COPY --from=builder /app/dist ./dist

# Run as non-root node user
USER node

EXPOSE 5000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:5000/api/v1/health || exit 1

CMD ["node", "dist/server.js"]
