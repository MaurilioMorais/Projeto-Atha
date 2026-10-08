FROM node:22-slim
WORKDIR /app
COPY package.json ./
RUN npm install
COPY . .
RUN npx ng build
ENV NODE_ENV=production PORT=3000 DB_FILE=/data/atha.db
VOLUME /data
EXPOSE 3000
CMD ["npx", "tsx", "server/index.ts"]
