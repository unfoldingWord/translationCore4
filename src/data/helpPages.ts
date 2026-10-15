// The help pages of this build (#519), served by the client at `<base>help/`.
// #729: the help panel swaps a page into its frame instead of loading it, so it
// reads the page here: same origin, no internet.

/** The help page at `url`, parsed, or null when the server answers with an error, a
 * redirect takes the read out of the help directory, or the answer is not HTML. The
 * panel runs the page's scripts, so only a help page may come back. */
export async function readHelpPage(url: string, signal: AbortSignal): Promise<Document | null> {
  const res = await fetch(url, { signal });
  if (!res.ok || !res.url.startsWith(new URL('.', url).href)) return null;
  if (!/^text\/html\b/i.test(res.headers.get('content-type') ?? '')) return null;
  return new DOMParser().parseFromString(await res.text(), 'text/html');
}
