FROM node:14.12-alpine

# REQUIRED ENV VARS:
# - STAGE
# - MONGO_URL
# - REDIS_URL

# TODO: Make a fully offline version which only hosts assets and bundles.

ADD . /app
WORKDIR /app

RUN \
  apk add --no-cache make gcc g++ python git && \
  yarn bootstrap && \
  cd styleguide && \
  yarn build && \
  yarn cache clean && \
  apk del make gcc g++ python git

WORKDIR /app/styleguide
CMD yarn start-production

EXPOSE 3000
