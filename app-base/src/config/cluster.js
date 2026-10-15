const cluster = {
    node1: {
        id: 'node1',
        apiPort: 3443,
        raftPort: 4001,
        mongoUri: 'mongodb://127.0.0.1:27017/user-api-node1'
    },

    node2: {
        id: 'node2',
        apiPort: 3444,
        raftPort: 4002,
        mongoUri: 'mongodb://127.0.0.1:27017/user-api-node2'
    },

    node3: {
        id: 'node3',
        apiPort: 3445,
        raftPort: 4003,
        mongoUri: 'mongodb://127.0.0.1:27017/user-api-node3'
    }
};

module.exports = cluster;