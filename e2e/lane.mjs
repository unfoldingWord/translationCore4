// #524: one port lane per worktree, so two checkouts can run the journeys at the
// same time. A lane is a vite port and a rig port. With neither variable set, the
// lane is the default one (5199 and 19998) and every caller behaves as before.
// Plain JS, not TS: vite.config.js imports it too.

export const DEFAULT_RIG_PORT = 19998;
export const DEFAULT_VITE_PORT = 5199;

/** @param {string | undefined} value @param {string} name @param {number} fallback */
const readPort = (value, name, fallback) => {
  if (value === undefined || value === '') return fallback;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`${name}=${value} is not a port number (1 to 65535).`);
  }
  return port;
};

/**
 * The ports of this run's lane, from TC4_RIG_PORT and TC4_VITE_PORT.
 * `named` is true when either variable is set: such a lane must start its own
 * servers and never reuse one that already listens on its ports.
 * @param {Record<string, string | undefined>} [env]
 */
export const lane = (env = process.env) => {
  const rigPort = readPort(env.TC4_RIG_PORT, 'TC4_RIG_PORT', DEFAULT_RIG_PORT);
  const vitePort = readPort(env.TC4_VITE_PORT, 'TC4_VITE_PORT', DEFAULT_VITE_PORT);
  return {
    rigPort,
    vitePort,
    named: Boolean(env.TC4_RIG_PORT || env.TC4_VITE_PORT),
    rigOrigin: `http://127.0.0.1:${rigPort}`,
    rigApi: `http://127.0.0.1:${rigPort}/api`,
    clientHost: `localhost:${vitePort}`,
    clientOrigin: `http://localhost:${vitePort}`,
  };
};
