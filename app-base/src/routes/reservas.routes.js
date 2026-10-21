const express = require('express');
const { randomUUID } = require('crypto');
const Reserva = require('../models/Reserva');
const redisClient = require('../redis');
const logger = require('../logger');

const router = express.Router();

/**
 * @swagger
 * /reservas:
 *   get:
 *     summary: Obtener todas las reservas
 *     tags: [Reservas]
 *     responses:
 *       200:
 *         description: Lista de reservas
 */
router.get('/', async (req, res) => {
    try {
        const reservas = await Reserva.find();

        logger.info('Reservas obtenidas', {
            cantidad: reservas.length
        });

        res.status(200).json(reservas);

    } catch (error) {
        logger.error('Error al obtener reservas', {
            message: error.message
        });

        res.status(500).json({
            message: 'Error interno del servidor'
        });
    }
});

/**
 * @swagger
 * /reservas/{id}/reservar:
 *   post:
 *     summary: Realizar una reserva
 *     tags: [Reservas]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Reserva realizada correctamente
 *       404:
 *         description: Recurso no encontrado
 *       409:
 *         description: No hay cupos disponibles
 *       423:
 *         description: Recurso ocupado
 */
router.post('/:id/reservar', async (req, res) => {
    const id = req.params.id;

    let reserva;

    try {
        reserva = await Reserva.findById(id);

        if (!reserva) {
            return res.status(404).json({
                message: 'Recurso no encontrado'
            });
        }

        const lockKey = `lock:reserva:${id}`;
        const lockValue = randomUUID();

        const lock = await redisClient.set(lockKey, lockValue, {
            NX: true,
            PX: 5000
        });

        if (lock !== 'OK') {
            logger.warn('Recurso ocupado', {
                id
            });

            return res.status(423).json({
                message: 'Recurso ocupado, intentá nuevamente'
            });
        }

        try {
            await new Promise(resolve => setTimeout(resolve, 2000));

            reserva = await Reserva.findById(id);

            if (!reserva) {
                return res.status(404).json({
                    message: 'Recurso no encontrado'
                });
            }

            if (reserva.disponibles <= 0) {
                logger.warn('No hay cupos disponibles', {
                    id
                });

                return res.status(409).json({
                    message: 'No hay cupos disponibles'
                });
            }

            reserva.disponibles--;

            await reserva.save();

            logger.info('Reserva realizada correctamente', {
                id: reserva._id,
                disponibles: reserva.disponibles
            });

            return res.status(200).json({
                message: 'Reserva realizada correctamente',
                recurso: reserva._id,
                disponibles: reserva.disponibles
            });

        } finally {
            const value = await redisClient.get(lockKey);

            if (value === lockValue) {
                await redisClient.del(lockKey);
            }
        }

    } catch (error) {
        logger.error('Error al realizar reserva', {
            message: error.message
        });

        return res.status(500).json({
            message: 'Error interno del servidor'
        });
    }
});

module.exports = router;