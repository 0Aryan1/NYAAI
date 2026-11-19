# One image, two start commands (HLD principle 6). Build from the repo root:
#   docker build -f apps/server/Dockerfile -t nyaai-server .
# Run with APP_ROLE=api or APP_ROLE=worker.
FROM node:22-slim
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH NODE_ENV=production
RUN npm i -g pnpm@12.21.0
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile --filter @nyaai/server...
USER node
CMD ["sh", "-c", "pnpm --filter @nyaai/server start:${APP_ROLE:-api}"]
