FROM oven/bun:1.3.12-slim
WORKDIR /app
ENV HUSKY=0 NODE_ENV=production
COPY package.json bun.lock bunfig.toml tsconfig.base.json ./
COPY gateway/package.json gateway/
COPY guards/package.json guards/
COPY mock-upstream/package.json mock-upstream/
COPY dashboard/package.json dashboard/
COPY evals/package.json evals/
COPY examples/package.json examples/
RUN bun install --frozen-lockfile --production --omit optional --ignore-scripts \
      --filter @palang-ai/gateway --filter @palang-ai/mock-upstream
COPY guards/src guards/src
COPY mock-upstream/src mock-upstream/src
COPY gateway/src gateway/src
COPY gateway/drizzle gateway/drizzle
USER bun
CMD ["bun", "run", "gateway/src/index.ts"]
