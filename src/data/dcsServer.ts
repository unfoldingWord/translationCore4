// The Door43 server for account and write calls (#120, owner ruling 2026-09-25).
//
// Contract: every call that acts on the user's Door43 account or writes to Door43
// — sign-in (#203), repository creation and push (#362), and any later such call —
// takes its address from DCS_SERVER. No read call does: resource pins, the
// catalogue, downloads, picture packs and discovery stay on production
// (`DCS_HOST` in gateways.ts).
//
// The build chooses the server, never the user. A development build (the Vite
// dev server, where the journeys run) uses qa.door43.org, which is reset weekly
// and holds no durable data. Any other build uses production. `DEV` must be
// exactly true: a build where it is absent gets production.

const PRODUCTION = 'https://git.door43.org';

/** The rule, over a build's `import.meta.env`. Exported so a test can pass an
 * env with no `DEV`: under Vitest `import.meta.env.DEV` is always a boolean. */
export const dcsServerFor = (env: { DEV?: unknown }): string => (env.DEV === true ? 'https://qa.door43.org' : PRODUCTION);

export const DCS_SERVER: string = dcsServerFor(import.meta.env);

/** The host to show beside the save indicator, or null on production. */
export const DCS_SERVER_LABEL: string | null = DCS_SERVER === PRODUCTION ? null : new URL(DCS_SERVER).host;
