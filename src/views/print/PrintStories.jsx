// The print DOM of an OBS project (#360): every story in order, in the flow
// layout. The PDF export renders it to static HTML and the desktop app prints
// it (src/data/export/pdf.ts). Each story opens with its title on its own
// page; then each frame is its picture above its text, and frames fill the page
// as they fit (print.css keeps a frame whole, so two share a page when both
// fit); then the reference line. An undrafted frame states so, never skipped.
// With pictures off, no frame has a picture. The wrapped layout is #11.
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { t } from '../../i18n';

/**
 * `stories` are the parsed stories (`Story`, src/data/burritoStore.ts) in
 * order; `pictures` maps a story number to its frames' picture sources, keyed
 * by frame number ("1" is the first frame). A frame with no source prints no
 * picture.
 */
export default function PrintStories({ stories, pictures, pageSetup, dir }) {
  return (
    <main className="print-book print-stories">
      {stories.map((story) => (
        <section key={story.number} className="print-story" dir={dir}>
          <h1 className="print-title print-story-title">{story.title || t('storyDraft.storyNumber', { n: story.number })}</h1>
          {story.frames.map((frame, i) => {
            const src = pageSetup.pictures ? pictures?.[story.number]?.[String(i + 1)] : undefined;
            return (
              <div key={i + 1} className="print-frame">
                {src && <img className="print-frame-picture" src={src} alt={t('storyDraft.imageAlt', { n: i + 1 })} />}
                <p className={frame.text ? 'print-frame-text' : 'print-frame-text print-undrafted'}>{frame.text || t('cc.notYetDraftedFrame')}</p>
              </div>
            );
          })}
          {story.ref && <p className="print-story-reference">{story.ref}</p>}
        </section>
      ))}
    </main>
  );
}

/** The print DOM as static HTML, for the print document. */
export const printStoriesHtml = (props) => renderToStaticMarkup(<PrintStories {...props} />);
