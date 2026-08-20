FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
ARG VITE_AUTH_URL
ARG VITE_GAME_SERVER_URL
ENV VITE_AUTH_URL=${VITE_AUTH_URL}
ENV VITE_GAME_SERVER_URL=${VITE_GAME_SERVER_URL}
RUN npm run build

FROM nginx:1.27-alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
