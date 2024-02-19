FROM node:18-alpine AS base

RUN npm i -g pnpm

FROM base as dependencies

WORKDIR /home/node/app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install

FROM base as dev

WORKDIR /home/node/app
COPY . .
COPY --from=dependencies /home/node/app/node_modules ./node_modules
