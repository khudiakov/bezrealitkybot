FROM node:12.4.0-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm install

COPY codegen.yml ./src ./
COPY src ./src
RUN npm run generate

RUN npm run compile


FROM node:12.4.0-alpine

WORKDIR /app

COPY --from=builder /app/generated ./generated

COPY package.json package-lock.json ./
RUN npm install --production

COPY .env.production ./.env
COPY ./src ./src

CMD ["npm", "start"]