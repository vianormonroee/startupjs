FROM node:14-alpine

# REQUIRED ENV VARS:
# - STAGE
# - MONGO_URL
# - REDIS_URL

# access private npm packages
ARG NPM_TOKEN=

ADD . /app
WORKDIR /app

RUN \
  # optionally use a custom npm token (if defined above)
  echo "//registry.npmjs.org/:_authToken=${NPM_TOKEN}" > ~/.npmrc && \
  # install build tools
  apk add --no-cache make gcc g++ python git && \
  # ffmpeg is required at runtime for video & audio conversion libraries
  apk add --no-cache ffmpeg && \
  # install dependencies
  yarn && \
  # build production bundles of server and web
  yarn build && \
  # cleanup yarn
  yarn cache clean && \
  # cleanup build tools
  apk del make gcc g++ python git

CMD yarn start-production

EXPOSE 3000
