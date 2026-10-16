// #679 (#680 takes it over): the one label function of a version's owner.
import { describe, expect, it } from 'vitest';
import { actorLabel } from '../src/views/actorLabel.js';

const ACTORS = ['actor-a', 'actor-b', 'actor-c', 'actor-d'];

describe('actorLabel', () => {
  it('names this installation "Mine", even when the fold records a name for it', () => {
    expect(actorLabel('actor-b', { 'actor-b': 'door43-b' }, 'actor-b', ACTORS)).toBe('Mine');
  });

  it('names a teammate by the Door43 name the fold records', () => {
    expect(actorLabel('actor-c', { 'actor-c': 'door43-c' }, 'actor-b', ACTORS)).toBe('door43-c');
  });

  it('numbers the teammates with no name by actor id order, without this installation and the named ones', () => {
    const names = { 'actor-c': 'door43-c' };
    expect(actorLabel('actor-a', names, 'actor-b', ACTORS)).toBe('Teammate 1');
    expect(actorLabel('actor-d', names, 'actor-b', ACTORS)).toBe('Teammate 2');
  });

  it('the three-argument contract of #680: a name, else "Teammate 1", and "Mine"', () => {
    expect(actorLabel('actor-c', { 'actor-c': 'door43-c' }, 'actor-b')).toBe('door43-c');
    expect(actorLabel('actor-a', {}, 'actor-b')).toBe('Teammate 1');
    expect(actorLabel('actor-b', {}, 'actor-b')).toBe('Mine');
  });
});
