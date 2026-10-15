// The help pages of this build (#519), served by the client at `<base>help/`.
// #729: the help panel swaps a page into its frame instead of loading it, so it
// reads the page here: same origin, no internet.

/** The help page at `url`, parsed, or null when the server answers with an error. */
export async function readHelpPage(url: string, signal: AbortSignal): Promise<Document | null> {
  const res = await fetch(url, { signal });
  if (!res.ok) return null;
  return new DOMParser().parseFromString(await res.text(), 'text/html');
}
