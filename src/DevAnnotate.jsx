import React, { useEffect, useState } from 'react';

// Dev-only bug-report overlay (react-grab-annotate). It writes screenshot +
// source location + comment to .react-grab/ for an AI agent to read. The import
// is dynamic so the package never enters the production bundle: `import.meta.env.DEV`
// is statically false in a build, and Rollup drops the branch.
export default function DevAnnotate() {
  const [Overlay, setOverlay] = useState(null);

  useEffect(() => {
    if (!import.meta.env.DEV) return;
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
