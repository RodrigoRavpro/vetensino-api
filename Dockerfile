# syntax=docker/dockerfile:1

# openssl é exigido pelo engine do Prisma na base alpine.
FROM node:22-alpine AS deps
RUN apk add --no-cache openssl
WORKDIR /app
COPY package.json yarn.lock ./
COPY prisma ./prisma
RUN yarn install --frozen-lockfile
RUN yarn prisma generate

FROM node:22-alpine AS build
RUN apk add --no-cache openssl
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN yarn build

FROM node:22-alpine AS runtime
RUN apk add --no-cache openssl
WORKDIR /app
ENV NODE_ENV=production

COPY package.json yarn.lock ./
COPY prisma ./prisma
RUN yarn install --frozen-lockfile --production && yarn prisma generate && yarn cache clean

COPY --from=build /app/dist ./dist

# Container roda sem privilégios de root.
USER node

EXPOSE 4000
CMD ["node", "dist/server.js"]
