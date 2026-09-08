// The ONE absence discriminator (D30) must read the platform's not-found text
// on every host the server runs on. Unix says "No such file or directory";
// Windows says "The system cannot find the file specified." (os error 2) or,
// for a missing directory in the path, "The system cannot find the path
// specified." (os error 3) — the text the #181 witness run saw on 2026-09-08
// when a fresh project's expected-absent reads reached the error dialog.
import { describe, expect, it } from 'vitest';
import { ServerApiError, isNotFoundError } from '../src/data/serverApi';

const err = (status: number, reason: string) => new ServerApiError('GET /burrito/ingredient/raw/x?ipath=y', status, reason);

describe('ServerApiError.isNotFound reads the not-found text of every platform', () => {
  it('Unix: No such file or directory (os error 2)', () => {
    const e = err(400, 'could not read ingredient content: No such file or directory (os error 2)');
    expect(e.isNotFound).toBe(true);
    expect(isNotFoundError(e)).toBe(true);
  });

  it('Windows: The system cannot find the file specified. (os error 2)', () => {
    const e = err(400, 'could not read ingredient content: The system cannot find the file specified. (os error 2)');
    expect(e.isNotFound).toBe(true);
    expect(isNotFoundError(e)).toBe(true);
  });

  it('Windows: The system cannot find the path specified. (os error 3)', () => {
    const e = err(400, 'could not read ingredient content: The system cannot find the path specified. (os error 3)');
    expect(e.isNotFound).toBe(true);
    expect(isNotFoundError(e)).toBe(true);
  });

  it('404 with any of the texts is accepted too', () => {
    expect(err(404, 'No such file or directory (os error 2)').isNotFound).toBe(true);
  });

  it('other failures are not absence', () => {
    expect(err(400, 'could not read ingredient content: Permission denied (os error 13)').isNotFound).toBe(false);
    expect(err(400, 'could not read ingredient content: Access is denied. (os error 5)').isNotFound).toBe(false);
    expect(err(500, 'No such file or directory (os error 2)').isNotFound).toBe(false);
    expect(err(400, 'bad repo path').isNotFound).toBe(false);
  });
});
