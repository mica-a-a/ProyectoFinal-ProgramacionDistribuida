const http = require('http');

const {
    state,
    persistState
} = require('./state');

function sendRequest(peer, path, data) {
    return new Promise((resolve, reject) => {
        const body = JSON.stringify(data);

        const req = http.request(
            {
                hostname: 'localhost',
                port: peer.raftPort,
                path,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(body)
                },
                timeout: 2000
            },
            res => {
                let response = '';

                res.on('data', chunk => {
                    response += chunk;
                });

                res.on('end', () => {
                    try {
                        resolve(JSON.parse(response));
                    } catch {
                        resolve({});
                    }
                });
            }
        );

        req.on('error', reject);

        req.on('timeout', () => {
            req.destroy();
            reject(new Error('Timeout'));
        });

        req.write(body);
        req.end();
    });
}

function initializeLeaderState() {
    for (const peer of state.peers) {
        state.nextIndex[peer.id] =
            state.log.length + 1;

        state.matchIndex[peer.id] = 0;
    }
}

async function replicateToPeer(peer) {
    if (state.role !== 'LEADER') {
        return false;
    }

    if (
        !state.nextIndex[peer.id] ||
        state.nextIndex[peer.id] < 1
    ) {
        state.nextIndex[peer.id] =
            state.log.length + 1;
    }

    while (state.nextIndex[peer.id] >= 1) {
        const nextIndex =
            state.nextIndex[peer.id];

        const prevLogIndex =
            nextIndex - 1;

        const previousEntry =
            prevLogIndex > 0
                ? state.log[prevLogIndex - 1]
                : null;

        const prevLogTerm =
            previousEntry
                ? previousEntry.term
                : 0;

        const entries =
            state.log.slice(nextIndex - 1);

        try {
            const response =
                await sendRequest(
                    peer,
                    '/raft/append-entries',
                    {
                        term: state.currentTerm,
                        leaderId: state.nodeId,
                        prevLogIndex,
                        prevLogTerm,
                        entries,
                        leaderCommit: state.commitIndex
                    }
                );

            if (
                typeof response.term === 'number' &&
                response.term > state.currentTerm
            ) {
                state.currentTerm =
                    response.term;

                state.role = 'FOLLOWER';
                state.leaderId = null;
                state.votedFor = null;

                await persistState();

                return false;
            }

            if (response.success) {
                state.matchIndex[peer.id] =
                    response.matchIndex ??
                    Math.max(
                        0,
                        state.log.length - 1
                    );

                state.nextIndex[peer.id] =
                    state.matchIndex[peer.id] + 1;

                return true;
            }

            state.nextIndex[peer.id]--;

            console.log(
                `[RAFT] ${peer.id} rechazó la entrada. nextIndex=${state.nextIndex[peer.id]}`
            );

        } catch {
            console.log(
                `[RAFT] ${peer.id} no disponible`
            );

            return false;
        }
    }

    return false;
}

async function replicateEntry(entry) {
    if (state.role !== 'LEADER') {
        return false;
    }

    let acknowledgements = 1;

    for (const peer of state.peers) {
        const replicated =
            await replicateToPeer(peer);

        if (replicated) {
            acknowledgements++;
        }
    }

    const majority =
        Math.floor(
            (state.peers.length + 1) / 2
        ) + 1;

    if (acknowledgements >= majority) {
        state.commitIndex =
            entry.index;

        await persistState();

        console.log(
            `[RAFT] Entrada ${entry.index} COMMIT con ${acknowledgements} votos`
        );

        await propagateCommit();

        return true;
    }

    return false;
}

async function propagateCommit() {
    for (const peer of state.peers) {
        try {
            await replicateToPeer(peer);
        } catch {
            // nodo temporalmente caído
        }
    }
}

async function appendCommand(command) {
    if (state.role !== 'LEADER') {
        return {
            committed: false,
            result: null
        };
    }

    const entry = {
        index: state.log.length + 1,
        term: state.currentTerm,
        operation: command
    };

    state.log.push(entry);

    await persistState();

    console.log(
        `[RAFT] Nueva entrada ${entry.index} - término ${entry.term}`
    );

    const committed =
        await replicateEntry(entry);

    if (!committed) {
        state.log.pop();

        await persistState();

        return {
            committed: false,
            result: null
        };
    }

    const result =
        await state.applyCommitted();

    return {
        committed: true,
        result
    };
}

module.exports = {
    initializeLeaderState,
    replicateEntry,
    replicateToPeer,
    appendCommand,
    propagateCommit
};