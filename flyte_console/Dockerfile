FROM ghcr.io/unionai-oss/flyteconsole-v2:latest

ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=8080

USER root
WORKDIR /app
COPY . /app

EXPOSE 8080
CMD ["node", "proxy-server.js"]
