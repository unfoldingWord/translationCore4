const started = performance.now();
const actions = new Map();
actions.set('probe', 'ok');
document.querySelector('#result').textContent = JSON.stringify({
  value: actions.get('probe'),
  milliseconds: performance.now() - started,
  changes: actions.size,
});
