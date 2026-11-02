FROM node:22-bookworm-slim
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8080 \
    STORE_DRIVER=mysql FILE_STORE=cos DATA_DIR=/tmp/ai-tender \
    PDF_FONT_DIR=/app/deploy/fonts
WORKDIR /app/server
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund && npm cache clean --force
COPY server/src ./src
COPY tools/preview /app/tools/preview
COPY miniprogram /app/miniprogram
COPY deploy/fonts /app/deploy/fonts
USER node
EXPOSE 8080
CMD ["node", "src/index.js"]
