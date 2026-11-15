FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@latest --activate
WORKDIR /app
COPY pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/db/package.json packages/db/
COPY packages/queue/package.json packages/queue/
COPY packages/integrations/package.json packages/integrations/
COPY apps/api/package.json apps/api/
COPY apps/worker/package.json apps/worker/
RUN pnpm install --no-frozen-lockfile
COPY packages packages
COPY apps/api apps/api
COPY apps/worker apps/worker
RUN pnpm --filter @plataforma/shared build && pnpm --filter @plataforma/db build && pnpm --filter @plataforma/queue build && pnpm --filter @plataforma/integrations build && pnpm --filter @plataforma/api build && pnpm --filter @plataforma/worker build
CMD ["node", "apps/worker/dist/worker.js"]
