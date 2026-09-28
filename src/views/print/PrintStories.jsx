// The print DOM of an OBS project (#360): the printed stories of
// src/data/storyModel.ts printedStories (#454), in the flow layout. The PDF
// export renders it to static HTML and the desktop app prints it
// (src/data/export/pdf.ts); the Community Checking preview states the same
// items. Each drafted story opens with its title on its own page; then each
// drafted frame is its picture above its text, and frames fill the page as
// they fit (print.css keeps a frame whole, so two share a page when both fit);
// a run of undrafted frames is one line with no picture; then the reference
// line. A run of undrafted stories between two drafted ones is one line. With
// pictures off, no frame has a picture. In the wrapped layout (#11) each
// picture is a quarter of the page width at the frame's start corner (left for
// a left-to-right language, right for right-to-left) and the text wraps it.
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { t } from '../../i18n';

/** The line that stands for undrafted frames `from`–`to` (one frame when equal). */
export const frameGapText = ([from, to]) =>
  from === to ? t('cc.frameNotDrafted', { n: from }) : t('cc.framesNotDrafted', { from, to });

/** The line that stands for undrafted stories `from`–`to` (one story when equal). */
export const storyGapText = ([from, to]) =>
  from === to ? t('cc.storyNotDrafted', { n: from }) : t('cc.storiesNotDrafted', { from, to });

/** A story's title, or its number when the title is empty. */
export const storyTitle = (story) => story.title || t('storyDraft.storyNumber', { n: story.number });

/**
 * `items` are the printed stories (`PrintedStory`, src/data/storyModel.ts) in
 * order; `pictures` maps a story number to its drafted frames' picture
 * sources, keyed by frame number ("1" is the first frame). A frame with no
 * source prints no picture. No items: one line says nothing is drafted.
 */
export default function PrintStories({ items, pictures, pageSetup, dir }) {
  // The start corner is a physical side, so the float side is stated in the DOM.
  const wrapped = pageSetup.obsLayout === 'wrapped' ? { float: dir === 'rtl' ? 'right' : 'left' } : undefined;
  return (
    <main className={pageSetup.obsLayout === 'wrapped' ? 'print-book print-stories print-stories-wrapped' : 'print-book print-stories'}>
      {items.length === 0 && <p className="print-nothing-drafted" dir={dir}>{t('cc.nothingDraftedObs')}</p>}
      {items.map((item) => item.gap
        ? <p key={`gap-${item.gap[0]}`} className="print-story-gap" dir={dir}>{storyGapText(item.gap)}</p>
        : (
          <section key={item.story.number} className="print-story" dir={dir}>
            <h1 className="print-title print-story-title">{storyTitle(item.story)}</h1>
            {item.frames.map((frame) => {
              if (frame.gap) return <p key={`gap-${frame.gap[0]}`} className="print-frame-gap">{frameGapText(frame.gap)}</p>;
              const src = pageSetup.pictures ? pictures?.[item.story.number]?.[String(frame.n)] : undefined;
              return (
                <div key={frame.n} className="print-frame">
                  {src && <img className="print-frame-picture" src={src} alt={t('storyDraft.imageAlt', { n: frame.n })} style={wrapped} />}
                  <p className="print-frame-text">{frame.text}</p>
                </div>
              );
            })}
            {item.story.ref && <p className="print-story-reference">{item.story.ref}</p>}
          </section>
        ))}
    </main>
  );
}

/** The print DOM as static HTML, for the print document. */
export const printStoriesHtml = (props) => renderToStaticMarkup(<PrintStories {...props} />);
