// The desktop keychain (issue #366, D85): the `TokenKeychain` seam of
// session.ts over the preload bridge `window.tc4Desktop.keychain`
// (scripts/preload.cjs), answered by `token:keep`, `token:read` and
// `token:forget` in scripts/desktop-main.cjs through Electron's
// `safeStorage`. The token is the only thing that crosses; nothing else about
// the person. A browser build has no bridge, so `desktopKeychain()` is null
// there and the token stays in renderer memory for the session (D84 point 6).
// The main process answers a keep it could not do (no keychain on this
// computer) with `kept: false` and the reason; that becomes the thrown error
// that `signIn` records as `keepError`, so the app can say so in one line.
import type { TokenKeychain } from './session';

interface KeychainBridge {
  keep(token: string): Promise<{ kept: boolean; reason?: string }>;
  read(): Promise<{ token: string | null; reason?: string }>;
  forget(): Promise<{ forgotten: boolean }>;
}

/** The keychain of the packaged desktop app, or null in a browser. (The
 * bridge's other members are typed where they are used, pdf.ts.) */
export const desktopKeychain = (): TokenKeychain | null => {
  const bridge = (globalThis.window as { tc4Desktop?: { keychain?: KeychainBridge } } | undefined)?.tc4Desktop?.keychain;
  if (!bridge) return null;
  return {
    keep: async (token) => {
      const answer = await bridge.keep(token);
      if (!answer.kept) throw new Error(answer.reason ?? 'the token was not kept');
    },
    read: async () => (await bridge.read()).token,
    forget: async () => {
      await bridge.forget();
    },
  };
};
