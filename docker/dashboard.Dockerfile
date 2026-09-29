FROM node:22-slim AS build
COPY --from=oven/bun:1.3.12-slim /usr/local/bin/bun /usr/local/bin/bun
WORKDIR /app
ENV HUSKY=0 NEXT_TELEMETRY_DISABLED=1
COPY package.json bun.lock bunfig.toml tsconfig.base.json ./
COPY gateway/package.json gateway/
COPY guards/package.json guards/
COPY mock-upstream/package.json mock-upstream/
COPY dashboard/package.json dashboard/
COPY evals/package.json evals/
COPY examples/package.json examples/
RUN bun install --frozen-lockfile --ignore-scripts --filter @palang-ai/dashboard
COPY dashboard dashboard
RUN cd dashboard && bun run build

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
COPY --from=build /app/dashboard/.next/standalone ./
USER node
EXPOSE 3000
CMD ["node", "dashboard/server.js"]
