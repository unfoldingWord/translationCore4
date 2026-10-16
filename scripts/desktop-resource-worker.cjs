const { parentPort, workerData } = require('node:worker_threads');
const { bootstrap } = require('./tc4-bootstrap.cjs');
Promise.resolve().then(() => bootstrap({ ...workerData, onProgress: (progress) => parentPort.postMessage({ type: 'progress', progress }) }))
  .then(() => parentPort.postMessage({ type: 'done' }));
