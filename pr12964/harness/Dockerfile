FROM node:22-bookworm AS node
FROM maven:3.9.11-eclipse-temurin-21
COPY --from=node /usr/local/bin/node /usr/local/bin/node
RUN apt-get update -qq && apt-get install -y -qq procps psmisc tini perl >/dev/null 2>&1 || true
