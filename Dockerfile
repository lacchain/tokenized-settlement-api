FROM node:14.4
WORKDIR /app
COPY ./package*.json ./
COPY ./src ./src
RUN npm ci
CMD ["npm", "start"]