FROM node:24-slim
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY server/package.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY server/ ./
RUN npx prisma generate
ENV NODE_ENV=production \
    NODE_ROLE=cloud \
    HOST=0.0.0.0 \
    PORT=4000 \
    WEB_DIR=/app/web
EXPOSE 4000
# Apply schema changes from a new release, then start. db push refuses changes that
# would delete data, so a risky update stops here instead of losing records.
CMD ["sh", "-c", "npx prisma db push && node dist/server.cjs"]
