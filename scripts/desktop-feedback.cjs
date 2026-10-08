'use strict';

// The help-desk send (#378, D89 point 10). The packaging recipe copies this
// file beside the main process as electron/tc4-feedback.cjs, and writes the
// build's TC_HELP_DESK_TOKEN and TC_HELP_DESK_EMAIL into
// electron/tc4-helpdesk.json. Neither value enters the web bundle. The send
// runs here, not in the page, because SendGrid's mail/send endpoint refuses
// cross-origin calls. The result is never thrown across IPC: the page keeps
// "sent", "not configured", "offline", "timeout" and "refused" apart.
const fs = require('fs');
const path = require('path');

const SENDGRID_URL = 'https://api.sendgrid.com/v3/mail/send';
const TIMEOUT_MS = 30_000;

/** The build's { token, email }, or null when this build has none. */
function loadHelpDesk(dir) {
  try {
    const { token, email } = JSON.parse(fs.readFileSync(path.join(dir, 'tc4-helpdesk.json'), 'utf8'));
    return { token, email };
  } catch {
    return null;
  }
}

/** The message, then the Name and Email lines when given, then the version, as tC3 does. */
const bodyOf = ({ message, name, email, version }) =>
  `${message}\n\n${name ? `Name: ${name}\n` : ''}${email ? `Email: ${email}\n` : ''}Version: ${version}\n`;

/** One email to the help desk, from the help desk (the verified sender); the
 * user's email, when given, is the reply-to. The attachment is the exact text
 * the dialog showed. */
async function sendFeedback(payload, { desk, fetch = globalThis.fetch, timeoutMs = TIMEOUT_MS }) {
  if (!desk?.token || !desk?.email) return { ok: false, reason: 'not-configured' };
  const mail = {
    personalizations: [{ to: [{ email: desk.email }] }],
    from: { email: desk.email },
    ...(payload.email ? { reply_to: { email: payload.email } } : {}),
    subject: `tC: ${payload.category}`,
    content: [{ type: 'text/plain', value: bodyOf(payload) }],
    attachments: [{ content: Buffer.from(payload.attachment, 'utf8').toString('base64'), filename: 'report.txt', type: 'text/plain', disposition: 'attachment' }],
  };
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeoutMs);
  try {
    const response = await fetch(SENDGRID_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${desk.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(mail),
      signal: abort.signal,
    });
    return response.ok ? { ok: true, status: response.status } : { ok: false, reason: 'refused', status: response.status };
  } catch {
    return { ok: false, reason: abort.signal.aborted ? 'timeout' : 'offline' };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { SENDGRID_URL, loadHelpDesk, sendFeedback };
