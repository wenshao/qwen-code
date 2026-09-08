FROM node:22-bookworm
RUN apt-get update && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /rig
COPY node_modules /rig/node_modules
COPY rig10457.mjs /rig/rig10457.mjs
COPY entrypoint.sh /rig/entrypoint.sh
RUN chmod +x /rig/entrypoint.sh
ENTRYPOINT ["/rig/entrypoint.sh"]
