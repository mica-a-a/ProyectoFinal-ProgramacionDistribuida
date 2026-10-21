# usuarios-service - imagen de produccion (TP6)
# Node 22 LTS: entradas-service exige node >=20.19 (mongoose 9), por eso no se usa 20-alpine.
FROM node:22-alpine

ENV NODE_ENV=production \
    PORT=3000

WORKDIR /app

# Primero solo los manifiestos: si no cambian las dependencias, Docker reutiliza esta capa en cache.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Codigo fuente (lo que excluye .dockerignore no entra a la imagen)
COPY . .

# Puerto interno. En Compose se publica hacia el host solo si hace falta.
EXPOSE 3000

# No correr como root dentro del contenedor
USER node

CMD ["npm", "start"]
