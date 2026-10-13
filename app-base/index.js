const express = require('express');
const usuarios = require('./usuarios.json');

const app = express();
const PORT = 3000;

app.use(express.json());

// 1. GET (Listar todos) - Devuelve 200 OK
app.get('/usuarios', (req, res) => {
    res.status(200).json(usuarios);
});

// 2. GET por ID (Consultar individual)
app.get('/usuarios/:id', (req, res) => {
    // VALIDACIÓN DE PARÁMETROS (req.params)
    const idUrl = parseInt(req.params.id);
    if (isNaN(idUrl)) {
        return res.status(400).json({ error: "Datos inválidos: El ID debe ser un número entero." });
    }

    const usuario = usuarios.find(u => u.id === idUrl);
    if (!usuario) {
        return res.status(404).json({ error: "Usuario no encontrado." });
    }

    res.status(200).json(usuario);
});

// 3. POST (Crear)
app.post('/usuarios', (req, res) => {
    const nuevoUsuario = req.body; 

    // VALIDACIÓN DE CUERPO (req.body) - Campos obligatorios
    if (!nuevoUsuario.dni || !nuevoUsuario.nombreApellido || !nuevoUsuario.fechaNacimiento || !nuevoUsuario.email || !nuevoUsuario.direccion) {
        return res.status(400).json({ error: "Datos incompletos: Se requieren los 5 campos obligatorios (dni, nombreApellido, fechaNacimiento, email, direccion)." });
    }

    nuevoUsuario.id = usuarios.length > 0 ? usuarios[usuarios.length - 1].id + 1 : 1;
    usuarios.push(nuevoUsuario);

    res.status(201).json({
        mensaje: "¡Usuario creado con éxito!",
        usuario: nuevoUsuario
    });
});

// 4. PUT (Actualizar)
app.put('/usuarios/:id', (req, res) => {
    // VALIDACIÓN DE PARÁMETROS (req.params)
    const idUrl = parseInt(req.params.id);
    if (isNaN(idUrl)) {
        return res.status(400).json({ error: "Datos inválidos: El ID debe ser un número entero." });
    }

    const datosActualizados = req.body;

    // VALIDACIÓN DE CUERPO (req.body) - Que no envíen un JSON vacío
    if (Object.keys(datosActualizados).length === 0) {
        return res.status(400).json({ error: "Datos inválidos: El cuerpo de la petición no puede estar vacío al actualizar." });
    }

    const usuario = usuarios.find(u => u.id === idUrl);
    if (!usuario) {
        return res.status(404).json({ error: "Usuario no encontrado para actualizar." });
    }

    usuario.dni = datosActualizados.dni || usuario.dni;
    usuario.nombreApellido = datosActualizados.nombreApellido || usuario.nombreApellido;
    usuario.fechaNacimiento = datosActualizados.fechaNacimiento || usuario.fechaNacimiento;
    usuario.email = datosActualizados.email || usuario.email;
    usuario.direccion = datosActualizados.direccion || usuario.direccion;

    res.status(200).json({
        mensaje: `¡Usuario con ID ${idUrl} actualizado con éxito!`,
        usuario: usuario
    });
});

// 5. DELETE (Eliminar)
app.delete('/usuarios/:id', (req, res) => {
    // VALIDACIÓN DE PARÁMETROS (req.params)
    const idUrl = parseInt(req.params.id);
    if (isNaN(idUrl)) {
        return res.status(400).json({ error: "Datos inválidos: El ID debe ser un número entero." });
    }

    const indice = usuarios.findIndex(u => u.id === idUrl);
    if (indice === -1) {
        return res.status(404).json({ error: "Usuario no encontrado para eliminar." });
    }

    const usuarioEliminado = usuarios.splice(indice, 1);

    res.status(200).json({
        mensaje: `¡Usuario con ID ${idUrl} eliminado con éxito!`,
        usuario: usuarioEliminado[0]
    });
});

app.listen(PORT, () => {
    console.log(`¡Servidor CRUD con VALIDACIONES corriendo en http://localhost:${PORT}!`);
});