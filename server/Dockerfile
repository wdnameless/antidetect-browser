FROM node:22-alpine AS build
WORKDIR /app
COPY package.json ./
# Build stage needs devDependencies: tsc type-checks against @types/node and
# @types/express, which --omit=dev would exclude.
RUN npm install --no-audit --no-fund
COPY tsconfig.json ./
COPY src ./src
RUN npx tsc -p tsconfig.json

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8787
ENV SYNC_DATA_DIR=/data
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/package.json ./package.json
RUN mkdir -p /data
VOLUME ["/data"]
EXPOSE 8787
CMD ["node", "dist/index.js"]