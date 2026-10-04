// #524: the port lane of a journey run, from TC4_RIG_PORT and TC4_VITE_PORT.
import { describe, expect, it } from 'vitest';
import { lane } from '../e2e/lane.mjs';

describe('lane', () => {
  it('with no variables, is the default lane on 19998 and 5199', () => {
    expect(lane({})).toEqual({
      rigPort: 19998,
      vitePort: 5199,
      named: false,
      rigOrigin: 'http://127.0.0.1:19998',
      rigApi: 'http://127.0.0.1:19998/api',
      clientHost: 'localhost:5199',
      clientOrigin: 'http://localhost:5199',
    });
  });

  it('an empty variable is the same as no variable', () => {
    expect(lane({ TC4_RIG_PORT: '', TC4_VITE_PORT: '' })).toMatchObject({ rigPort: 19998, vitePort: 5199, named: false });
  });

  it('reads both overrides, and the lane is named', () => {
    expect(lane({ TC4_RIG_PORT: '19999', TC4_VITE_PORT: '5299' })).toEqual({
      rigPort: 19999,
      vitePort: 5299,
      named: true,
      rigOrigin: 'http://127.0.0.1:19999',
      rigApi: 'http://127.0.0.1:19999/api',
      clientHost: 'localhost:5299',
      clientOrigin: 'http://localhost:5299',
    });
  });

  it('one override names the lane and keeps the other default', () => {
    expect(lane({ TC4_RIG_PORT: '19999' })).toMatchObject({ rigPort: 19999, vitePort: 5199, named: true });
    expect(lane({ TC4_VITE_PORT: '5299' })).toMatchObject({ rigPort: 19998, vitePort: 5299, named: true });
  });

  it('refuses a value that is not a port', () => {
    for (const bad of ['abc', '0', '65536', '19998.5', '-1']) {
      expect(() => lane({ TC4_RIG_PORT: bad })).toThrow(`TC4_RIG_PORT=${bad} is not a port number`);
    }
    expect(() => lane({ TC4_VITE_PORT: 'x' })).toThrow('TC4_VITE_PORT=x is not a port number');
  });

  it('reads process.env when no environment is passed', () => {
    const before = process.env.TC4_RIG_PORT;
    process.env.TC4_RIG_PORT = '20001';
    try {
      expect(lane().rigApi).toBe('http://127.0.0.1:20001/api');
    } finally {
      if (before === undefined) delete process.env.TC4_RIG_PORT;
      else process.env.TC4_RIG_PORT = before;
    }
  });
});
