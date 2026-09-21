FROM node:22-alpine

WORKDIR /app

ENV NODE_ENV=production

# Install dependencies first so they're cached across rebuilds.
COPY package.json package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund

# Server core
COPY server.js store.js audit.js release.json ./

# Root web assets (must match the server's static allow-list)
COPY index.html bootstrap.js splash.js sw.js manifest.json icon-192.png icon-512.png ./

# Portal pages
COPY home home/
COPY documents documents/
COPY fields fields/
COPY ["data fields/", "data fields/"]
COPY profile profile/
COPY ["login page/", "login page/"]
COPY ["create account/", "create account/"]
COPY shared shared/

ENV PORT=3000
ENV DATA_DIR=/tmp/vcpl-data
EXPOSE 3000
CMD ["node", "server.js"]