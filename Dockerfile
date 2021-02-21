ARG NODE_ENV=production

FROM node:14.15.5-alpine AS builder
RUN npm install -g npm

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm install

COPY codegen.yml ./
COPY src ./src

RUN npm run generate
RUN npm run build

FROM node:14.15.5-alpine
ARG NODE_ENV

COPY --from=builder /app/dist ./dist

ENV NODE_ENV=${NODE_ENV}
CMD ["node", "dist/app.js"]