const cluster = require('../config/cluster');
const mongoose = require('mongoose');

const nodeId = process.env.NODE_ID || 'node1';
const nodeConfig = cluster[nodeId];

if (!nodeConfig) {
    throw new Error(`NODE_ID inválido: ${nodeId}`);
}

const raftStateSchema = new mongoose.Schema(
    {
        nodeId: {
            type: String,
            required: true,
            unique: true
        },
        currentTerm: {
            type: Number,
            default: 0
        },
        votedFor: {
            type: String,
            default: null
        },
        log: {
            type: Array,
            default: []
        },
        commitIndex: {
            type: Number,
            default: 0
        },
        lastApplied: {
            type: Number,
            default: 0
        }
    },
    {
        collection: 'raft_state'
    }
);

const RaftState =
    mongoose.models.RaftState ||
    mongoose.model('RaftState', raftStateSchema);

const state = {
    nodeId,
    role: 'FOLLOWER',
    currentTerm: 0,
    votedFor: null,
    leaderId: null,
    log: [],
    commitIndex: 0,
    lastApplied: 0,
    nextIndex: {},
    matchIndex: {},

    peers: Object.values(cluster)
        .filter(node => node.id !== nodeId)
        .map(node => ({
            id: node.id,
            raftPort: node.raftPort
        }))
};

async function persistState() {
    let saved = await RaftState.findOne({
        nodeId: state.nodeId
    });

    if (!saved) {
        saved = new RaftState({
            nodeId: state.nodeId
        });
    }

    saved.currentTerm = state.currentTerm;
    saved.votedFor = state.votedFor;
    saved.log = state.log;
    saved.commitIndex = state.commitIndex;
    saved.lastApplied = state.lastApplied;

    await saved.save();
}

async function loadPersistedState() {
    const saved = await RaftState.findOne({
        nodeId: state.nodeId
    }).lean();

    if (!saved) {
        await persistState();

        return;
    }

    state.currentTerm = saved.currentTerm || 0;
    state.votedFor = saved.votedFor || null;
    state.log = saved.log || [];
    state.commitIndex = saved.commitIndex || 0;
    state.lastApplied = saved.lastApplied || 0;

    console.log(
        `[RAFT] Estado recuperado para ${state.nodeId}`
    );

    console.log(
        `[RAFT] term=${state.currentTerm} log=${state.log.length} commit=${state.commitIndex} applied=${state.lastApplied}`
    );
}

state.applyCommitted = async function () {
    const {
        applyCommand
    } = require('./stateMachine');

    let lastResult = null;

    while (
        state.lastApplied <
        state.commitIndex
    ) {
        const entry =
            state.log[state.lastApplied];

        if (entry) {
            const applied =
                await applyCommand(
                    entry.operation
                );

            lastResult =
                applied.result;
        }

        state.lastApplied++;

        await persistState();
    }

    return lastResult;
};

module.exports = {
    state,
    nodeConfig,
    persistState,
    loadPersistedState,
    RaftState
};