# ProyectoFinal-ProgramacionDistribuida
Trabajo final de la materia programacion distribuida
# Proyecto Elegido: Eventos y Entradas

**Materia:** Programación Distribuida · Licenciatura en Sistemas de Información (UCH)

## Integrantes

| Apellido y Nombre | Usuario de GitHub |
|-------------------|-------------------|
| `Bazan Franco` | `francobazan11` |
| `Gorri Juan` | `jnahuelgorrig` |
| `Le Donne Micaela` | `mica-a-a` |
| `Molina Agostina` | `molinagos` |
| `Nievas Milagros` | `milinievas` |


**Grupo:** `2`

**Docentes agregados como colaboradores:** alvarezadriel@uch.edu.ar · cortezedgardo@uch.edu.ar

## De qué trata

Este repositorio parte de la API REST de Usuarios desarrollada en los trabajos anteriores (HTTPS, MongoDB, Winston, Swagger, Redis, Raft) y la evoluciona hacia una arquitectura de microservicios para un sistema de **eventos y entradas**.

El **TP5 es de análisis y diseño**: la arquitectura propuesta está documentada y justificada en [`docs/arquitectura.md`](docs/arquitectura.md). La implementación de los servicios se realiza en los trabajos siguientes.

## Estructura del repositorio

```
proyecto-distribuido/
├── README.md                       Este archivo
├── .gitignore                      Excluye dependencias, .env, logs, claves y certificados
├── .env.example                    Variables de entorno de ejemplo (sin valores sensibles)
├── .github/
│   └── pull_request_template.md    Plantilla de Pull Request
├── docs/
│   ├── arquitectura.md             Análisis, responsabilidades, acoplamientos, servicios, datos, comunicaciones
│   ├── diagrama-arquitectura.svg   Diagrama de arquitectura (también .png)
│   ├── flujo-git.md                Flujo de ramas, commits, PR y tags del grupo
│   └── evidencias/                 Capturas de Git y de la app base (ítem 6)
├── app-base/                       Versión funcional de partida (API de Usuarios)
└── services/                       Trabajo futuro de cada microservicio
    ├── usuarios-service/
    ├── eventos-service/
    └── entradas-service/
```

## Versión funcional de partida (`app-base/`)

Es la API REST de Usuarios (Node.js + Express). Antes de migrar, debe poder instalarse, ejecutarse y probarse:

```bash
cd app-base
npm install
npm start
```

El servidor queda en `http://localhost:3000`. Pruebas rápidas:

```bash
curl http://localhost:3000/usuarios
curl http://localhost:3000/usuarios/1
```

> `app-base/` contiene la versión del TP1 (CRUD con datos en memoria). Si el grupo acuerda partir de una versión más avanzada (con MongoDB, HTTPS, Winston, Swagger o Raft), debe reemplazar el contenido de esta carpeta por esa versión y actualizar esta sección.

## Requisitos

- Node.js LTS y npm
- Git
- (Para los TPs de implementación) MongoDB Community Server y Redis/Memurai

## Variables de entorno y datos sensibles

- Las variables requeridas están documentadas en [`.env.example`](.env.example), sin valores sensibles.
- Cada servicio usa su propio `.env`, que **no se versiona**.
- Las claves y certificados de desarrollo no se suben (`certs/`, `*.key`, `*.pem`, `*.pfx` están ignorados). Para generar un certificado autofirmado local:

```bash
mkdir -p certs
openssl req -x509 -newkey rsa:2048 -nodes -keyout certs/server.key -out certs/server.cert -days 365 -subj "/CN=localhost"
```

## Flujo de trabajo con Git

- La rama principal es `main`. No se desarrolla directamente sobre ella.
- Cada tarea se hace en una rama propia (`feature/...`, `docs/...`, `fix/...`) y se integra mediante **Pull Request** con revisión de otro integrante.
- Los mensajes de commit describen cambios concretos.
- Cada entrega queda marcada con un tag (`tp5-entrega`, `tp6-entrega`, etc.).

Detalle completo en [`docs/flujo-git.md`](docs/flujo-git.md).

## Entregables del TP5 y dónde encontrarlos

| # | Entregable | Dónde está |
|---|------------|-----------|
| 1 | URL del repositorio único | Este repositorio |
| 2 | Listado de integrantes | Sección *Integrantes* de este README |
| 3 | Docentes como colaboradores | Settings → Collaborators de GitHub (ver `docs/evidencias/`) |
| 4 | Versión funcional de partida | [`app-base/`](app-base/) |
| 5 | `.gitignore` y variables sensibles | [`.gitignore`](.gitignore) y [`.env.example`](.env.example) |
| 6 | Evidencia de ramas, commits y Pull Request | Historial del repositorio y [`docs/evidencias/`](docs/evidencias/) |
| 7 | Inventario de funcionalidades y endpoints | [`docs/arquitectura.md` §2](docs/arquitectura.md#2-análisis-de-la-aplicación-existente-inventario) |
| 8 | Identificación de responsabilidades | [`docs/arquitectura.md` §3](docs/arquitectura.md#3-identificación-de-responsabilidades) |
| 9 | Tres ejemplos de acoplamiento y desacople | [`docs/arquitectura.md` §4](docs/arquitectura.md#4-identificación-de-acoplamientos) |
| 10 | Propuesta de al menos tres microservicios | [`docs/arquitectura.md` §5](docs/arquitectura.md#5-propuesta-de-microservicios) |
| 11 | Ficha y justificación de cada microservicio | [`docs/arquitectura.md` §5.1](docs/arquitectura.md#5-propuesta-de-microservicios) |
| 12 | Matriz de propiedad de datos | [`docs/arquitectura.md` §6](docs/arquitectura.md#6-propiedad-y-acceso-a-los-datos) |
| 13 | Matriz de comunicaciones | [`docs/arquitectura.md` §7](docs/arquitectura.md#7-comunicación-entre-microservicios) |
| 14 | Trazado de al menos dos casos de uso | [`docs/arquitectura.md` §8](docs/arquitectura.md#8-trazado-de-casos-de-uso) |
| 15 | Diagrama de arquitectura | [`docs/diagrama-arquitectura.svg`](docs/diagrama-arquitectura.svg) |
| 16 | Checklist de validación de límites | [`docs/arquitectura.md` §10](docs/arquitectura.md#10-validación-de-los-límites-propuestos-checklist) |
