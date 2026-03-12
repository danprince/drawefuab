FROM oven/bun:1
WORKDIR /usr/src/app

COPY . .
RUN bun install --frozen-lockfile

ENV NODE_ENV=production
RUN bun run build

USER bun
EXPOSE 3000/tcp
ENTRYPOINT [ "bun", "start" ]
