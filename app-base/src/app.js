const express = require('express');
const swaggerUi = require('swagger-ui-express');

const usersRouter = require('./routes/users.routes');
const reservasRouter = require('./routes/reservas.routes');
const swaggerSpec = require('./swagger');
const raftRouter = require('./routes/raft.routes');
const app = express();

app.use(express.json());

app.get('/', (req, res) => {
    res.json({
        message: 'Bienvenido a User API'
    });
});

app.use('/users', usersRouter);
app.use('/reservas', reservasRouter);
app.use('/raft', raftRouter);
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

app.get('/api-docs.json', (req, res) => {
    res.json(swaggerSpec);
});

module.exports = app;