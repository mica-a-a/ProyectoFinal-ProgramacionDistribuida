const express = require('express');

const {
    state,
    nodeConfig,
    persistState
} = require('../raft/state');

const {
    appendCommand
} = require('../raft/replication');

const {
    resetElectionTimer
} = require('../raft/election');

const router = express.Router();

router.get('/status', (req, res) => {
    res.json({
        nodeId: state.nodeId,
        role: state.role,
        currentTerm: state.currentTerm,
        leaderId: state.leaderId,
        commitIndex: state.commitIndex,
        lastApplied: state.lastApplied,
        logLength: state.log.length,
        apiPort: nodeConfig.apiPort,
        raftPort: nodeConfig.raftPort,
        peers: state.peers
    });
});

router.get('/log', (req, res) => {
    res.json({
        nodeId: state.nodeId,
        currentTerm: state.currentTerm,
        commitIndex: state.commitIndex,
        lastApplied: state.lastApplied,
        log: state.log
    });
});

router.post('/request-vote', async (req, res) => {
    const {
        term,
        candidateId
    } = req.body;

    if (
        typeof term !== 'number' ||
        typeof candidateId !== 'string'
    ) {
        return res.status(400).json({
            term: state.currentTerm,
            voteGranted: false
        });
    }

    if (term < state.currentTerm) {
        return res.json({
            term: state.currentTerm,
            voteGranted: false
        });
    }

    if (term > state.currentTerm) {
        state.currentTerm = term;
        state.role = 'FOLLOWER';
        state.votedFor = null;
        state.leaderId = null;
    }

    let voteGranted = false;

    if (
        state.votedFor === null ||
        state.votedFor === candidateId
    ) {
        state.votedFor = candidateId;
        voteGranted = true;

        resetElectionTimer();
    }

    await persistState();

    res.json({
        term: state.currentTerm,
        voteGranted
    });
});

router.post('/append-entries', async (req, res) => {
    const {
        term,
        leaderId,
        prevLogIndex = 0,
        prevLogTerm = 0,
        entries = [],
        leaderCommit = 0
    } = req.body;

    if (
        typeof term !== 'number' ||
        typeof leaderId !== 'string'
    ) {
        return res.status(400).json({
            success: false,
            term: state.currentTerm
        });
    }

    if (term < state.currentTerm) {
        return res.json({
            term: state.currentTerm,
            success: false,
            matchIndex: state.log.length
        });
    }

    if (term > state.currentTerm) {
        state.currentTerm = term;
        state.votedFor = null;
    }

    state.role = 'FOLLOWER';
    state.leaderId = leaderId;

    resetElectionTimer();

    if (prevLogIndex > 0) {
        const previousEntry =
            state.log[prevLogIndex - 1];

        if (
            !previousEntry ||
            previousEntry.term !== prevLogTerm
        ) {
            await persistState();

            return res.json({
                term: state.currentTerm,
                success: false,
                matchIndex: state.log.length
            });
        }
    }

    for (const entry of entries) {
        const position = entry.index - 1;

        if (state.log[position]) {
            if (
                state.log[position].term !== entry.term
            ) {
                state.log.splice(position);
            }
        }

        if (!state.log[position]) {
            state.log.push(entry);
        }
    }

    if (leaderCommit > state.commitIndex) {
        state.commitIndex = Math.min(
            leaderCommit,
            state.log.length
        );
    }

    await persistState();

    if (
        state.commitIndex >
        state.lastApplied
    ) {
        await state.applyCommitted();
    }

    await persistState();

    res.json({
        term: state.currentTerm,
        success: true,
        matchIndex: state.log.length
    });
});

router.post('/command', async (req, res) => {
    if (state.role !== 'LEADER') {
        return res.status(409).json({
            message: 'Este nodo no es LEADER',
            leaderId: state.leaderId
        });
    }

    if (
        !req.body ||
        !req.body.operation
    ) {
        return res.status(400).json({
            message: 'La operación es obligatoria'
        });
    }

    try {
        const result =
            await appendCommand(
                req.body.operation
            );

        if (!result.committed) {
            return res.status(503).json({
                message: 'No se alcanzó quorum',
                commitIndex: state.commitIndex
            });
        }

        res.status(201).json({
            message: 'Operación comprometida',
            leaderId: state.nodeId,
            term: state.currentTerm,
            commitIndex: state.commitIndex,
            operation: req.body.operation,
            result: result.result
        });
    } catch (error) {
        res.status(500).json({
            message: 'Error replicando operación',
            error: error.message
        });
    }
});

module.exports = router;