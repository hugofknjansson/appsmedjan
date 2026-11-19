# The Appsmedjan server (API, WebSockets, AI agent) together with the built web client.
# The Mac build worker is not part of this image: it runs on a Mac and connects out to the server.
FROM node:24-slim
WORKDIR /app

# Dependencies first, so they are only reinstalled when a package file changes.
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY worker/package.json worker/
COPY web/package.json web/
RUN npm ci

COPY shared shared
COPY server server
COPY web web
RUN npm run build

ENV NODE_ENV=production \
    PORT=8080 \
    DATA_DIR=/data
EXPOSE 8080

# The server is TypeScript run through tsx, the same way `npm start` runs it.
CMD ["node", "--import", "tsx", "server/src/index.ts"]
