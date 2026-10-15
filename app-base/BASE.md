# Versión base

Esta carpeta contiene la versión funcional de partida del proyecto: la API de Usuarios del **TP4** (HTTPS, MongoDB, Redis, Winston, Swagger y cluster de tres nodos con Raft educativo), sin cambios de código respecto de esa entrega.

Es el estado conocido y reproducible sobre el cual se analiza la aplicación y se diseña la migración a microservicios (TP5). La arquitectura propuesta está en `../docs/arquitectura.md`.

## Cómo ejecutarla

Requisitos: Node.js, MongoDB y Redis en ejecución, y un certificado HTTPS de desarrollo (ver `README.md`, sección 6.1).

```bash
cd app-base
cp .env.example .env
npm install
npm run node1     # en otra terminal: npm run node2 y npm run node3
```

Prueba rápida (el cluster elige un Leader automáticamente):

```bash
curl -k https://localhost:3443/raft/status
curl -k https://localhost:3443/users
curl -k https://localhost:3443/reservas
```

Documentación de la API: `https://localhost:3443/api-docs`.
