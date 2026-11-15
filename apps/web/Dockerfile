FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@latest --activate
WORKDIR /app
COPY pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/templates/package.json packages/templates/
COPY apps/web/package.json apps/web/
RUN pnpm install --no-frozen-lockfile
COPY packages/shared packages/shared
COPY packages/templates packages/templates
COPY apps/web apps/web
RUN pnpm --filter @plataforma/shared build && pnpm --filter @plataforma/templates build && pnpm --filter @plataforma/web build
EXPOSE 3000
CMD ["pnpm", "--filter", "@plataforma/web", "start"]
