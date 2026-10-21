require('dotenv').config();

const https = require('https');
const http = require('http');
const fs = require('fs');

const app = require('./app');
const redisClient = require('./redis');
const connectDB = require('./db');
const logger = require('./logger');

const {
    state,
    nodeConfig,
    loadPersistedState
} = require('./raft/state');

const {
    startElectionTimer
} = require('./raft/election');

const options = {
    key: fs.readFileSync('./certs/server.key'),
    cert: fs.readFileSync('./certs/server.crt')
};

async function startServer() {
    try {
        process.env.MONGODB_URI =
            nodeConfig.mongoUri;

        await connectDB();

        await loadPersistedState();

        await redisClient.connect();

        logger.info('Nodo iniciado', {
            nodeId: state.nodeId,
            role: state.role,
            currentTerm: state.currentTerm,
            apiPort: nodeConfig.apiPort,
            raftPort: nodeConfig.raftPort,
            mongoUri: nodeConfig.mongoUri
        });

        https.createServer(
            options,
            app
        ).listen(
            nodeConfig.apiPort,
            () => {
                logger.info(
                    `API HTTPS del ${state.nodeId} corriendo en https://localhost:${nodeConfig.apiPort}`
                );
            }
        );

        http.createServer(
            app
        ).listen(
            nodeConfig.raftPort,
            () => {
                logger.info(
                    `Servidor Raft interno del ${state.nodeId} corriendo en http://localhost:${nodeConfig.raftPort}`
                );
            }
        );

        startElectionTimer();

    } catch (error) {
        logger.error(
            'Error al iniciar el servidor',
            {
                message: error.message,
                stack: error.stack
            }
        );

        process.exit(1);
    }
}

startServer();