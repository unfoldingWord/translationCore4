const started = performance.now();
const A = await import('@automerge/automerge');
let doc = A.from({ actions: {} });
doc = A.change(doc, (draft) => { draft.actions.probe = new A.ImmutableString('ok'); });
document.querySelector('#result').textContent = JSON.stringify({
  value: String(doc.actions.probe),
  milliseconds: performance.now() - started,
  changes: A.getAllChanges(doc).length,
});
