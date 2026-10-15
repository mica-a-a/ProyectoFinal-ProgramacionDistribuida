const User = require('../models/User');

async function applyCommand(operation) {
    if (!operation || !operation.type) {
        throw new Error('Operación Raft inválida');
    }

    switch (operation.type) {
        case 'CREATE_USER': {
            const user = await User.create(operation.data);

            return {
                type: 'CREATE_USER',
                result: user
            };
        }

        case 'UPDATE_USER': {
            const user = await User.findByIdAndUpdate(
                operation.id,
                operation.data,
                {
                    new: true,
                    runValidators: true
                }
            );

            if (!user) {
                throw new Error('Usuario no encontrado');
            }

            return {
                type: 'UPDATE_USER',
                result: user
            };
        }

        case 'DELETE_USER': {
            const user = await User.findByIdAndDelete(
                operation.id
            );

            if (!user) {
                throw new Error('Usuario no encontrado');
            }

            return {
                type: 'DELETE_USER',
                result: user
            };
        }

        default:
            throw new Error(
                `Operación no soportada: ${operation.type}`
            );
    }
}

module.exports = {
    applyCommand
};