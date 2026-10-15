const http = require('http');

const {
    state,
    persistState
} = require('./state');

const {
    initializeLeaderState
} = require('./replication');

let electionTimer = null;
let heartbeatTimer = null;

const ELECTION_MIN = 4000;
const ELECTION_MAX = 7000;
const HEARTBEAT_INTERVAL = 1000;

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

function resetElectionTimer() {
    if (electionTimer) {
        clearTimeout(electionTimer);
    }

    const timeout =
        ELECTION_MIN +
        Math.floor(
            Math.random() *
            (ELECTION_MAX - ELECTION_MIN)
        );

    electionTimer = setTimeout(
        startElection,
        timeout
    );
}

async function startElection() {
    if (state.role === 'LEADER') {
        return;
    }

    state.role = 'CANDIDATE';
    state.currentTerm++;
    state.votedFor = state.nodeId;
    state.leaderId = null;

    await persistState();

    let votes = 1;

    console.log(
        `[RAFT] ${state.nodeId} inicia elección - término ${state.currentTerm}`
    );

    for (const peer of state.peers) {
        try {
            const response =
                await sendRequest(
                    peer,
                    '/raft/request-vote',
                    {
                        term: state.currentTerm,
                        candidateId: state.nodeId
                    }
                );

            if (
                response.term >
                state.currentTerm
            ) {
                state.currentTerm =
                    response.term;

                state.role = 'FOLLOWER';
                state.votedFor = null;
                state.leaderId = null;

                await persistState();

                resetElectionTimer();

                return;
            }

            if (response.voteGranted) {
                votes++;
            }
        } catch {
            console.log(
                `[RAFT] ${peer.id} no disponible`
            );
        }
    }

    const majority =
        Math.floor(
            (state.peers.length + 1) / 2
        ) + 1;

    if (votes >= majority) {
        becomeLeader();
    } else {
        state.role = 'FOLLOWER';

        await persistState();

        resetElectionTimer();
    }
}

function becomeLeader() {
    state.role = 'LEADER';
    state.leaderId = state.nodeId;

    initializeLeaderState();

    console.log(
        `[RAFT] ${state.nodeId} es LEADER - término ${state.currentTerm}`
    );

    if (electionTimer) {
        clearTimeout(electionTimer);
        electionTimer = null;
    }

    startHeartbeats();
}

function startHeartbeats() {
    if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
    }

    sendHeartbeats();

    heartbeatTimer =
        setInterval(() => {
            if (state.role !== 'LEADER') {
                clearInterval(
                    heartbeatTimer
                );

                heartbeatTimer = null;

                return;
            }

            sendHeartbeats();
        }, HEARTBEAT_INTERVAL);
}

async function sendHeartbeats() {
    for (const peer of state.peers) {
        try {
            await sendRequest(
                peer,
                '/raft/append-entries',
                {
                    term: state.currentTerm,
                    leaderId: state.nodeId,
                    prevLogIndex:
                        state.nextIndex[peer.id]
                            ? state.nextIndex[peer.id] - 1
                            : state.log.length,
                    prevLogTerm:
                        state.nextIndex[peer.id] &&
                        state.nextIndex[peer.id] > 1 &&
                        state.log[
                            state.nextIndex[peer.id] - 2
                        ]
                            ? state.log[
                                  state.nextIndex[peer.id] - 2
                              ].term
                            : 0,
                    entries: [],
                    leaderCommit:
                        state.commitIndex
                }
            );
        } catch {
            // nodo no disponible
        }
    }
}

function startElectionTimer() {
    resetElectionTimer();
}

module.exports = {
    startElectionTimer,
    resetElectionTimer
};