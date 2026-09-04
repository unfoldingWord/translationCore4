// Hybrid logical clock — BURRITO-SPEC §8.2 reference implementation.
// ts = "<ISO-8601 UTC fixed-width ms Z>|<4-hex counter>|<actorId>"
// Plain string comparison of ts values IS the total order.
//
// The GRAMMAR of a ts (and of the actor slug inside it) lives in grammar.mjs — the one
// value-grammar module (round 8). This module owns the clock BEHAVIOR only, and
// re-exports the grammar for its existing importers.
import { TS_RE, isTs, actorSlugError } from './grammar.mjs';
export { TS_RE, isTs };

const ISO_LEN = 24; // "2026-07-07T14:03:22.113Z"

export const makeClock = (actorId, now = () => Date.now()) => {
  const err = actorSlugError(actorId);
  if (err) throw new Error(`invalid actorId: ${actorId} — ${err}`);
  let lastPhysical = 0; // ms epoch
  let counter = 0;

  const issue = () => {
    let phys = now();
    if (phys > lastPhysical) {
      lastPhysical = phys;
      counter = 0;
    } else {
      counter += 1;
      if (counter > 0xffff) {
        lastPhysical += 1; // overflow: bump physical 1 ms, reset (§8.2)
        counter = 0;
      }
    }
    const iso = new Date(lastPhysical).toISOString();
    if (iso.length !== ISO_LEN) throw new Error(`non-fixed-width ISO ts: ${iso}`);
    return `${iso}|${counter.toString(16).padStart(4, '0')}|${actorId}`;
  };

  // Receiving any event ratchets the local clock (§8.2).
  const ratchet = (ts) => {
    const { physical, counter: c } = parseTs(ts);
    if (physical > lastPhysical || (physical === lastPhysical && c >= counter)) {
      lastPhysical = physical;
      counter = c; // next issue() at same physical increments past it
    }
  };

  return { issue, ratchet };
};

export const parseTs = (ts) => {
  const m = TS_RE.exec(ts);
  if (!m) throw new Error(`malformed ts: ${ts}`);
  return { physical: Date.parse(m[1]), counter: parseInt(m[2], 16), actor: m[3], iso: m[1] };
};

export const compareTs = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
