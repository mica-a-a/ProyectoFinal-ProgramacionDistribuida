# Flujo de trabajo con Git del grupo

## 1. Configuración inicial de cada integrante

```bash
git --version
git config --global user.name "Nombre Apellido"
git config --global user.email "correo@ejemplo.com"
git config --list
```

El correo debe permitir identificar al autor de los commits (idealmente el mismo asociado a la cuenta de GitHub).

## 2. Crear el repositorio base (lo hace una sola persona)

1. En GitHub, crear un repositorio **vacío** (sin README ni `.gitignore` automáticos), privado.
2. Desde la carpeta del proyecto:

```bash
git init -b main
git add .gitignore .env.example README.md app-base
git commit -m "Add initial shared repository"
git remote add origin https://github.com/USUARIO/NOMBRE-REPO.git
git push -u origin main
```

3. En **Settings → Collaborators → Add people**, agregar a todos los integrantes y a los docentes:
   - alvarezadriel@uch.edu.ar
   - cortezedgardo@uch.edu.ar

> El acceso de los docentes debe mantenerse durante toda la secuencia de trabajos prácticos.

## 3. Cada integrante clona el repositorio

```bash
git clone https://github.com/USUARIO/NOMBRE-REPO.git
cd NOMBRE-REPO
git status
```

## 4. Ramas: una por tarea

No se desarrolla directamente sobre `main`.

```bash
git switch main
git pull
git switch -c docs/inventario-endpoints
# ... trabajar ...
git add docs/arquitectura.md
git commit -m "Document existing endpoints inventory"
git push -u origin docs/inventario-endpoints
```

Luego se abre un **Pull Request** hacia `main` en GitHub, se pide revisión a otro integrante y se hace el merge.

### Plan de ramas sugerido para el TP5

| Rama | Contenido | Sección de `arquitectura.md` |
|------|-----------|------------------------------|
| `docs/estructura-y-readme` | README, estructura de carpetas, `services/` | (README) |
| `docs/inventario-responsabilidades` | Inventario de endpoints y responsabilidades | §2 y §3 |
| `docs/acoplamientos` | Acoplamientos y propuesta de desacople | §4 |
| `docs/microservicios` | Fichas, tabla general, propiedad de datos | §5 y §6 |
| `docs/comunicaciones-casos-de-uso` | Matriz de comunicaciones y trazado de casos de uso | §7 y §8 |
| `docs/diagrama-y-checklist` | Diagrama y checklist de validación | §9 y §10 |

Cada integrante debería tener al menos una rama propia con sus commits y su Pull Request, para que la participación individual pueda verificarse en el historial.

## 5. Commits

Los commits representan cambios concretos. Se evitan mensajes como "cambios", "final", "prueba" o "ahora sí".

```
Add initial shared repository
Document existing endpoints inventory
Document service boundaries
Add data ownership matrix
Add service communication table
Add architecture diagram
```

## 6. Pull Requests

Cada Pull Request indica brevemente:

1. Qué problema resuelve.
2. Qué partes del proyecto modifica.
3. Cómo fue validado antes de integrarse.

(La plantilla en `.github/pull_request_template.md` lo completa automáticamente.)

## 7. Operaciones básicas que todos deben poder explicar

| Comando | Para qué sirve |
|---------|----------------|
| `git clone` | Copiar el repositorio remoto a la máquina local |
| `git status` | Ver el estado de los archivos |
| `git branch` | Listar o crear ramas |
| `git switch` | Cambiar de rama (`-c` para crearla) |
| `git add` | Preparar cambios para el commit |
| `git commit` | Registrar los cambios preparados |
| `git pull` | Traer y combinar cambios del remoto |
| `git push` | Enviar commits locales al remoto |
| `git merge` | Integrar una rama en otra |

## 8. Marcar la entrega con un tag

Una vez aprobado el contenido en `main`:

```bash
git switch main
git pull
git tag tp5-entrega
git push origin tp5-entrega
```

En los TPs siguientes se usan etiquetas equivalentes (`tp6-entrega`, `tp7-entrega`, etc.). La rama `main` sigue evolucionando después de cada entrega.

## 9. Datos sensibles

- No subir `.env`, contraseñas, tokens, claves privadas ni certificados (ya están en `.gitignore`).
- Antes de cada commit, revisar con `git status` que no aparezcan archivos sensibles.
- Si se subió un secreto por accidente, **cambiar la credencial**: borrar el archivo en un commit posterior no lo elimina del historial.
