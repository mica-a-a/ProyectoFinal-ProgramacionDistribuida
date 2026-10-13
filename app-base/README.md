# Trabajo Práctico N° 1: API REST con Node.js y Express

**Materia:** Programación Distribuida  
**Estudiante:** [Micaela Le Donne]  

Este proyecto es una API RESTful básica que implementa operaciones CRUD (Create, Read, Update, Delete) utilizando Node.js y Express. Los datos son mockeados en memoria utilizando un arreglo de objetos JavaScript, y corresponden a registros de "Usuarios".

---

##  Requisitos Previos

Antes de ejecutar el proyecto, asegúrate de tener instalado en tu sistema:
- **Node.js** (Versión LTS recomendada)
- **npm** (Viene instalado por defecto con Node.js)
- **Postman** o **cURL** (Para probar los endpoints)

---

##  Instrucciones para levantar el proyecto paso a paso

Seguir estas instrucciones con cuidado para ejecutar el servidor en tu entorno local:

### Paso 1: Descargar el proyecto y abrir la terminal
Extrae los archivos del proyecto y abre la carpeta raíz en tu editor de código preferido (como Visual Studio Code o Antigravity). Abre una nueva terminal integrada asegurándote de estar ubicado en la ruta de la carpeta.

### Paso 2: Instalar las dependencias
Dado que la carpeta `node_modules` no se incluye en la entrega por buenas prácticas, debes instalar las dependencias (Express) leyendo el archivo `package.json`.
Ejecuta el siguiente comando en la terminal:
\`\`\`bash
npm install
\`\`\`

### Paso 3: Iniciar el servidor
Una vez que las dependencias terminen de instalarse, levanta el servidor ejecutando el script configurado:
\`\`\`bash
npm start
\`\`\`
Si todo es correcto, verás en la consola el mensaje: `¡Servidor CRUD corriendo en http://localhost:3000!`

---

## Endpoints Implementados (CRUD)

La API corre de forma local en el puerto `3000`. Puedes probar las siguientes rutas en Postman:

| Método | Endpoint | Acción / Descripción | Status HTTP Esperado |
| :--- | :--- | :--- | :--- |
| **GET** | `/usuarios` | Lista todos los registros de usuarios. | `200 OK` |
| **GET** | `/usuarios/:id` | Consulta los datos de un usuario individual por su ID. | `200 OK` / `400 Bad Request` / `404 Not Found` |
| **POST** | `/usuarios` | Crea un nuevo usuario. (Requiere body JSON con 5 campos: dni, nombreApellido, fechaNacimiento, email, direccion). | `201 Created` / `400 Bad Request` |
| **PUT** | `/usuarios/:id` | Modifica los datos de un usuario existente identificado por ID. | `200 OK` / `400 Bad Request` / `404 Not Found` |
| **DELETE** | `/usuarios/:id` | Elimina un registro de usuario existente identificado por ID. | `200 OK` / `400 Bad Request` / `404 Not Found` |

---
