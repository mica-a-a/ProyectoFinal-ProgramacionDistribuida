const express = require('express');
const User = require('../models/User');
const logger = require('../logger');
const mongoose = require('mongoose');
const { state } = require('../raft/state');
const { appendCommand } = require('../raft/replication');
const router = express.Router();

/**
 * @swagger
 * components:
 *   schemas:
 *     User:
 *       type: object
 *       properties:
 *         _id:
 *           type: string
 *           example: "66d123456789abcdef123456"
 *         nombre:
 *           type: string
 *           example: "Juan"
 *         apellido:
 *           type: string
 *           example: "Perez"
 *         email:
 *           type: string
 *           format: email
 *           example: "juan@test.com"
 *         edad:
 *           type: integer
 *           example: 25
 *         createdAt:
 *           type: string
 *           format: date-time
 *         updatedAt:
 *           type: string
 *           format: date-time
 */

/**
 * @swagger
 * /users:
 *   get:
 *     summary: Obtener todos los usuarios
 *     tags: [Users]
 *     responses:
 *       200:
 *         description: Lista de usuarios
 */
router.get('/', async (req, res) => {
    try {
        const users = await User.find();

        logger.info('Usuarios obtenidos', {
            cantidad: users.length
        });

        res.status(200).json(users);

    } catch (error) {
        logger.error('Error al obtener usuarios', {
            message: error.message
        });

        res.status(500).json({
            message: 'Error interno del servidor'
        });
    }
});

/**
 * @swagger
 * /users/{id}:
 *   get:
 *     summary: Obtener un usuario por ID
 *     tags: [Users]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Usuario encontrado
 *       400:
 *         description: ID inválido
 *       404:
 *         description: Usuario no encontrado
 */
router.get('/:id', async (req, res) => {
    try {
        const user = await User.findById(req.params.id);

        if (!user) {
            logger.warn('Usuario no encontrado', {
                id: req.params.id
            });

            return res.status(404).json({
                message: 'Usuario no encontrado'
            });
        }

        logger.info('Usuario obtenido', {
            id: user._id
        });

        res.status(200).json(user);

    } catch (error) {
        logger.warn('ID de usuario inválido', {
            id: req.params.id
        });

        res.status(400).json({
            message: 'ID de usuario inválido'
        });
    }
});

/**
 * @swagger
 * /users:
 *   post:
 *     summary: Crear un usuario
 *     tags: [Users]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - nombre
 *               - apellido
 *               - email
 *               - edad
 *             properties:
 *               nombre:
 *                 type: string
 *                 example: "Maria"
 *               apellido:
 *                 type: string
 *                 example: "Gomez"
 *               email:
 *                 type: string
 *                 format: email
 *                 example: "maria@test.com"
 *               edad:
 *                 type: integer
 *                 example: 30
 *     responses:
 *       201:
 *         description: Usuario creado correctamente
 *       400:
 *         description: Error de validación
 *       409:
 *         description: Email duplicado
 */
router.post('/', async (req, res) => {
    try {
        if (state.role !== 'LEADER') {
            return res.status(409).json({
                message: 'Este nodo no es LEADER',
                leaderId: state.leaderId
            });
        }

        const { nombre, apellido, email, edad } = req.body;

        const operation = {
            type: 'CREATE_USER',
            data: {
                _id: new mongoose.Types.ObjectId(),
                nombre,
                apellido,
                email,
                edad
            }
        };

        const result = await appendCommand(operation);

        if (!result.committed) {
            return res.status(503).json({
                message: 'No se alcanzó quorum'
            });
        }

        logger.info('Usuario creado mediante Raft', {
            id: result.result._id,
            email: result.result.email,
            term: state.currentTerm
        });

        res.status(201).json(result.result);

    } catch (error) {

        if (error.code === 11000) {
            logger.warn('Intento de crear usuario con email duplicado', {
                email: req.body.email
            });

            return res.status(409).json({
                message: 'El email ya está registrado'
            });
        }

        if (error.name === 'ValidationError') {
            return res.status(400).json({
                message: 'Error de validación',
                errors: Object.values(error.errors).map(
                    err => err.message
                )
            });
        }

        logger.error('Error al crear usuario mediante Raft', {
            message: error.message
        });

        res.status(500).json({
            message: 'Error interno del servidor'
        });
    }
});

/**
 * @swagger
 * /users/{id}:
 *   put:
 *     summary: Actualizar un usuario
 *     tags: [Users]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - nombre
 *               - apellido
 *               - email
 *               - edad
 *             properties:
 *               nombre:
 *                 type: string
 *                 example: "Maria"
 *               apellido:
 *                 type: string
 *                 example: "Lopez"
 *               email:
 *                 type: string
 *                 format: email
 *                 example: "maria.lopez@test.com"
 *               edad:
 *                 type: integer
 *                 example: 31
 *     responses:
 *       200:
 *         description: Usuario actualizado
 *       400:
 *         description: Error de validación o ID inválido
 *       404:
 *         description: Usuario no encontrado
 *       409:
 *         description: Email duplicado
 */
router.put('/:id', async (req, res) => {
    try {
        if (state.role !== 'LEADER') {
            return res.status(409).json({
                message: 'Este nodo no es LEADER',
                leaderId: state.leaderId
            });
        }

        const { nombre, apellido, email, edad } = req.body;

        const operation = {
            type: 'UPDATE_USER',
            id: req.params.id,
            data: {
                nombre,
                apellido,
                email,
                edad
            }
        };

        const result = await appendCommand(operation);

        if (!result.committed) {
            return res.status(503).json({
                message: 'No se alcanzó quorum'
            });
        }

        logger.info('Usuario actualizado mediante Raft', {
            id: result.result._id,
            term: state.currentTerm
        });

        res.status(200).json(result.result);

    } catch (error) {

        if (error.message === 'Usuario no encontrado') {
            return res.status(404).json({
                message: 'Usuario no encontrado'
            });
        }

        if (error.code === 11000) {
            return res.status(409).json({
                message: 'El email ya está registrado'
            });
        }

        if (error.name === 'ValidationError') {
            return res.status(400).json({
                message: 'Error de validación',
                errors: Object.values(error.errors).map(
                    err => err.message
                )
            });
        }

        logger.error('Error al actualizar usuario mediante Raft', {
            message: error.message
        });

        res.status(400).json({
            message: 'ID de usuario inválido'
        });
    }
});

/**
 * @swagger
 * /users/{id}:
 *   delete:
 *     summary: Eliminar un usuario
 *     tags: [Users]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Usuario eliminado correctamente
 *       400:
 *         description: ID inválido
 *       404:
 *         description: Usuario no encontrado
 */
router.delete('/:id', async (req, res) => {
    try {
        if (state.role !== 'LEADER') {
            return res.status(409).json({
                message: 'Este nodo no es LEADER',
                leaderId: state.leaderId
            });
        }

        const operation = {
            type: 'DELETE_USER',
            id: req.params.id
        };

        const result = await appendCommand(operation);

        if (!result.committed) {
            return res.status(503).json({
                message: 'No se alcanzó quorum'
            });
        }

        logger.info('Usuario eliminado mediante Raft', {
            id: result.result._id,
            email: result.result.email,
            term: state.currentTerm
        });

        res.status(200).json({
            message: 'Usuario eliminado correctamente',
            user: result.result
        });

    } catch (error) {

        if (error.message === 'Usuario no encontrado') {
            return res.status(404).json({
                message: 'Usuario no encontrado'
            });
        }

        logger.warn('ID de usuario inválido', {
            id: req.params.id
        });

        res.status(400).json({
            message: 'ID de usuario inválido'
        });
    }
});
module.exports = router;