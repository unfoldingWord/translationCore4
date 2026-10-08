// #378: the help-desk send of the main process. Failure modes M1–M7 of the
// pull request, written before the code. `fetch` is faked: the real send is
// the owner's proof on a packaged build.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loadHelpDesk, sendFeedback, SENDGRID_URL } = require('./desktop-feedback.cjs');

const DESK = { token: 'SG.marker-token', email: 'help@example.org' };
const REPORT = 'translationCore 4.0.1 (abc1234) · MacIntel\nReport: open, 2026-10-08T10:00:00.000Z\n{\n  "op": "open"\n}\n';
const PAYLOAD = { category: 'Bug Report', message: 'The open was refused.', name: '', email: '', version: 'translationCore 4.0.1 (abc1234)', attachment: REPORT };

function fakeFetch(answer) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    return answer(init);
  };
  fn.calls = calls;
  return fn;
}
const status = (code) => () => ({ status: code, ok: code >= 200 && code < 300 });

test('M1: no token or no address in the build sends nothing', async () => {
  for (const desk of [null, { token: '', email: DESK.email }, { token: DESK.token, email: '' }]) {
    const fetch = fakeFetch(status(202));
    assert.deepEqual(await sendFeedback(PAYLOAD, { desk, fetch }), { ok: false, reason: 'not-configured' });
    assert.equal(fetch.calls.length, 0);
  }
});

test('M1: the build values come from tc4-helpdesk.json beside the main process', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc4-helpdesk-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  assert.equal(loadHelpDesk(dir), null);
  fs.writeFileSync(path.join(dir, 'tc4-helpdesk.json'), JSON.stringify(DESK));
  assert.deepEqual(loadHelpDesk(dir), DESK);
  fs.writeFileSync(path.join(dir, 'tc4-helpdesk.json'), 'not json');
  assert.equal(loadHelpDesk(dir), null);
});

test('M2/M3: SendGrid refuses (401, 403, 400): not sent, with the status', async () => {
  for (const code of [401, 403, 400]) {
    const fetch = fakeFetch(status(code));
    assert.deepEqual(await sendFeedback(PAYLOAD, { desk: DESK, fetch }), { ok: false, reason: 'refused', status: code });
    assert.equal(fetch.calls.length, 1);
  }
});

test('M4: no network: not sent, offline', async () => {
  const fetch = fakeFetch(() => { throw new TypeError('fetch failed'); });
  assert.deepEqual(await sendFeedback(PAYLOAD, { desk: DESK, fetch }), { ok: false, reason: 'offline' });
});

test('M5: no answer in the time limit: the request is aborted, timeout', async () => {
  let signal;
  const fetch = fakeFetch((init) => new Promise((_resolve, reject) => {
    signal = init.signal;
    init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
  }));
  assert.deepEqual(await sendFeedback(PAYLOAD, { desk: DESK, fetch, timeoutMs: 20 }), { ok: false, reason: 'timeout' });
  assert.equal(signal.aborted, true);
});

test('M6: SendGrid accepts (202): sent', async () => {
  const fetch = fakeFetch(status(202));
  assert.deepEqual(await sendFeedback(PAYLOAD, { desk: DESK, fetch }), { ok: true, status: 202 });
});

test('M7: one request to mail/send, from and to the help desk, the attachment bytes as shown', async () => {
  const fetch = fakeFetch(status(202));
  await sendFeedback(PAYLOAD, { desk: DESK, fetch });
  const [{ url, init, body }] = fetch.calls;
  assert.equal(url, SENDGRID_URL);
  assert.equal(init.method, 'POST');
  assert.equal(init.headers.Authorization, `Bearer ${DESK.token}`);
  assert.deepEqual(body.personalizations, [{ to: [{ email: DESK.email }] }]);
  assert.deepEqual(body.from, { email: DESK.email });
  assert.equal('reply_to' in body, false);
  assert.equal(body.subject, 'tC: Bug Report');
  assert.deepEqual(body.content, [{ type: 'text/plain', value: 'The open was refused.\n\nVersion: translationCore 4.0.1 (abc1234)\n' }]);
  assert.equal(body.attachments.length, 1);
  assert.equal(Buffer.from(body.attachments[0].content, 'base64').toString('utf8'), REPORT);
  assert.equal(body.attachments[0].filename, 'report.txt');
});

test('M7: a given name and email go in the body, and the email is the reply-to', async () => {
  const fetch = fakeFetch(status(202));
  await sendFeedback({ ...PAYLOAD, category: 'General Feedback', name: 'Ana', email: 'ana@example.org' }, { desk: DESK, fetch });
  const [{ body }] = fetch.calls;
  assert.deepEqual(body.from, { email: DESK.email });
  assert.deepEqual(body.reply_to, { email: 'ana@example.org' });
  assert.equal(body.subject, 'tC: General Feedback');
  assert.equal(body.content[0].value, 'The open was refused.\n\nName: Ana\nEmail: ana@example.org\nVersion: translationCore 4.0.1 (abc1234)\n');
});
