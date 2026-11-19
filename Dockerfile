FROM node:24.19.0-bookworm-slim AS base
WORKDIR /app
RUN npm install --global pnpm@12.5.1
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

FROM base AS web-build
COPY apps/web/package.json apps/web/package.json
RUN pnpm --filter @lumo/web install --frozen-lockfile
COPY apps/web/ apps/web/
ARG NEXT_PUBLIC_API_ORIGIN
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
ENV LUMO_STANDALONE=true NEXT_TELEMETRY_DISABLED=1
RUN pnpm --filter @lumo/web build

FROM node:24.19.0-bookworm-slim AS web
ENV NODE_ENV=production PORT=8080 HOSTNAME=0.0.0.0 NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
COPY --from=web-build --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=web-build --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=web-build --chown=node:node /app/apps/web/public ./apps/web/public
USER node
CMD ["node", "apps/web/server.js"]

FROM base AS api-build
COPY apps/api/package.json apps/api/package.json
RUN pnpm --filter @lumo/api install --frozen-lockfile --ignore-scripts
COPY apps/api/ apps/api/
RUN pnpm --filter @lumo/api build
RUN pnpm --filter @lumo/api --prod deploy --legacy /runtime

FROM node:24.19.0-bookworm-slim AS api
ENV NODE_ENV=production PORT=8080
WORKDIR /app
COPY --from=api-build /runtime/node_modules ./apps/api/node_modules
COPY --from=api-build /app/apps/api/dist ./apps/api/dist
COPY apps/api/assets/ ./apps/api/assets/
COPY supabase/migrations/ ./supabase/migrations/
USER node
CMD ["node", "apps/api/dist/main.js"]
