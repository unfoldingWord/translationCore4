import React, { useEffect, useState } from 'react';

// Bug-report overlay (react-grab-annotate): it saves a screenshot, the source
// location and a comment to ~/.tc4-annotations for an agent to read.
//
// It mounts only under `npm run dev:annotate`, which runs `vite --mode annotate`.
// Plain `npm run dev` leaves it off, so the overlay never appears for someone who
// did not ask for it — and it cannot appear without its server, which that script
// starts alongside vite.
//
// Nothing reaches a build: `import.meta.env.DEV` is statically false and MODE is
// `production` there, so Rollup drops the branch and the package with it.
export default function DevAnnotate() {
  const [Overlay, setOverlay] = useState(null);

  useEffect(() => {
    if (!import.meta.env.DEV || import.meta.env.MODE !== 'annotate') return;
    let cancelled = false;
    import('react-grab-annotate').then((m) => {
      if (!cancelled) setOverlay(() => m.ReactGrabAnnotate);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!Overlay) return null;
  return <Overlay />;
}
