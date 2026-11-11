//! A source text's book as its Understand pane shows it (unit B3): each chapter's verses with
//! their text, their tokens and the paragraph marks around them, and the chapter's
//! translator's sections. Pure: the open book's resources are read once (`helps::BookCache`)
//! and every chapter is answered from this.
//!
//! The rules are tC4's (`tC4:src/views/sections.js`, `SourceVerse.jsx`, `verseText.js`): the
//! text is [`tc_usfm::display_text`], the tokens [`tc_usfm::display_tokens`], a section
//! starts at a chapter's first verse and at the first verse after each `\ts\*`, and a verse
//! key is a verse number or a bridge (`4-5`).

use std::borrow::Cow;
use std::collections::BTreeMap;

use tc_api::editor::{PaneChapter, PaneVerse};
use tc_api::helps::LitVerse;
use tc_api::ids::RefPart;
use tc_helps::highlight::{
    AlignedVerse, SourceWord, TokenKind, gateway_quote, highlight_original, highlight_quote,
};
use tc_helps::{Occurrence, Quote};
use tc_usfm::{Book, DisplaySource, DisplayVerse, SegmentKind, VerseUnit};

/// One verse of a pane, with what a card's highlight is computed on.
#[derive(Debug, Clone)]
pub struct VerseModel {
    pub key: RefPart,
    /// The first and last verse the key covers.
    pub from: u16,
    pub to: u16,
    pub view: PaneVerse,
    /// The tokens with their alignments, for tc-helps' highlight: the whole verse.
    pub aligned: AlignedVerse,
    reading: SpanReading,
}

/// How a help on some verses of this verse reads its gateway words (#409).
#[derive(Debug, Clone)]
enum SpanReading {
    /// A single verse, or a span with a source word whose verse is not known: every help
    /// reads every word.
    Whole,
    /// A verse span whose every source word names one of its own verses by `x-ref`: a help
    /// on some of its verses reads only their words.
    ByVerse(DisplayVerse),
}

impl SpanReading {
    fn of(display: DisplayVerse, chapter: u16, from: u16, to: u16) -> Self {
        let told_apart = from < to
            && display.groups.iter().flatten().all(|s| {
                s.x_ref
                    .is_some_and(|(c, v)| c == chapter && (from..=to).contains(&v))
            });
        if told_apart {
            Self::ByVerse(display)
        } else {
            Self::Whole
        }
    }
}

impl VerseModel {
    /// The aligned words a help at verses `from`..=`to` reads in this verse.
    pub fn aligned_at(&self, from: u16, to: u16) -> Cow<'_, AlignedVerse> {
        let covers_all = from <= self.from && self.to <= to;
        match &self.reading {
            // Every token stays, only alignments are left out, so the lit token indexes are
            // the pane's.
            SpanReading::ByVerse(display) if !covers_all => {
                Cow::Owned(aligned_where(display, |s| {
                    s.x_ref.is_some_and(|(_, v)| (from..=to).contains(&v))
                }))
            }
            SpanReading::ByVerse(_) | SpanReading::Whole => Cow::Borrowed(&self.aligned),
        }
    }

    /// The tokens of this original-language verse that a note's quote names (owner ruling
    /// Q39, tC4 #840), matched against its `\\w` words.
    pub fn original_lit(&self, quote: &Quote, occurrence: Occurrence) -> Vec<u32> {
        let (at, words): (Vec<usize>, Vec<&str>) = self
            .aligned
            .tokens()
            .iter()
            .enumerate()
            .filter(|(_, t)| matches!(t.kind, TokenKind::Word(_)))
            .map(|(i, t)| (i, t.text.as_str()))
            .unzip();
        highlight_original(&words, quote, occurrence)
            .into_iter()
            .filter_map(|k| u32::try_from(at[k]).ok())
            .collect()
    }
}

/// One chapter of a pane.
#[derive(Debug, Clone, Default)]
pub struct ChapterModel {
    pub sections: Vec<u16>,
    pub verses: Vec<VerseModel>,
}

impl ChapterModel {
    pub fn view(&self) -> PaneChapter {
        PaneChapter {
            sections: self.sections.clone(),
            verses: self.verses.iter().map(|v| v.view.clone()).collect(),
        }
    }

    /// The pane's verse that holds all of `verse` (`7` or `6-7`), by itself or inside a verse
    /// span, with the alignments a help on `verse` reads there (#409).
    pub fn holding(&self, verse: &str) -> Option<(&VerseModel, Cow<'_, AlignedVerse>)> {
        let (from, to) = verse_range(verse)?;
        let model = self.verses.iter().find(|m| m.from <= from && to <= m.to)?;
        Some((model, model.aligned_at(from, to)))
    }

    /// The pane's rendering of a quote at `verse` (a help's verse part, `1` or `1-3`), and the
    /// tokens of each verse that renders it: tC4's `glTitleFor` and `SourceVerse`. The title
    /// comes from the first verse that carries the help and renders the quote.
    pub fn focus(
        &self,
        verse: &str,
        quote: &Quote,
        occurrence: Occurrence,
    ) -> (Option<String>, Vec<LitVerse>) {
        let Some((from, to)) = verse_range(verse) else {
            return (None, Vec::new());
        };
        let mut title = None;
        let mut lit = Vec::new();
        for model in self.verses.iter().filter(|m| m.from <= to && from <= m.to) {
            let aligned = model.aligned_at(from, to);
            if title.is_none() {
                title = gateway_quote(&aligned, quote, occurrence);
            }
            let tokens: Vec<u32> = highlight_quote(&aligned, quote, occurrence)
                .tokens
                .into_iter()
                .filter_map(|i| u32::try_from(i).ok())
                .collect();
            if !tokens.is_empty() {
                lit.push(LitVerse {
                    verse: model.key.clone(),
                    tokens,
                });
            }
        }
        (title, lit)
    }

    /// [`Self::focus`] for the original-language text: the verses at `verse` that hold the
    /// quote, and its tokens there.
    pub fn original_focus(
        &self,
        verse: &str,
        quote: &Quote,
        occurrence: Occurrence,
    ) -> Vec<LitVerse> {
        let Some((from, to)) = verse_range(verse) else {
            return Vec::new();
        };
        self.verses
            .iter()
            .filter(|m| m.from <= to && from <= m.to)
            .filter_map(|model| {
                let tokens = model.original_lit(quote, occurrence);
                (!tokens.is_empty()).then(|| LitVerse {
                    verse: model.key.clone(),
                    tokens,
                })
            })
            .collect()
    }
}

/// A pane's book, by chapter.
#[derive(Debug, Clone, Default)]
pub struct PaneBook {
    pub chapters: BTreeMap<u16, ChapterModel>,
}

/// `4` → (4, 4), `4-5` → (4, 5); anything else (`intro`, `3a`) is none. tC4's `keyCarries`
/// reads the same two forms.
pub fn verse_range(text: &str) -> Option<(u16, u16)> {
    let (from, to) = text.split_once('-').unwrap_or((text, text));
    let digits = |s: &str| !s.is_empty() && s.bytes().all(|b| b.is_ascii_digit());
    if !digits(from) || !digits(to) {
        return None;
    }
    Some((from.parse().ok()?, to.parse().ok()?))
}

/// tC4's `isParaMark`, by marker name: `\p`, `\m`, `\pi`, `\pm`, `\pmo`, `\nb`, `\b`, `\q`,
/// `\li`, `\lh`, `\lf`, `\lim`, with a level digit where tC4 allows one.
pub(crate) fn is_para_mark(name: &str) -> bool {
    let with_level = |base: &str| {
        name.strip_prefix(base).is_some_and(|rest| {
            rest.is_empty() || (rest.len() == 1 && rest.as_bytes()[0].is_ascii_digit())
        })
    };
    matches!(name, "p" | "m" | "pm" | "pmo" | "nb" | "b" | "lh" | "lf")
        || with_level("pi")
        || with_level("q")
        || with_level("li")
        || with_level("lim")
}

/// tC4's `levelOfTag`: `\q2` is 2, `\q` 1, any other marker 0.
pub(crate) fn level(name: &str) -> u8 {
    match name.strip_prefix('q') {
        Some("") => 1,
        Some(digits) => digits.parse().unwrap_or(0),
        None => 0,
    }
}

/// The paragraph markers named in `text` (a unit's leading markers), in order.
fn para_marks(text: &str) -> Vec<&str> {
    let (before, after) = tc_usfm::edge_markers(text);
    before
        .into_iter()
        .chain(after)
        .filter(|m| is_para_mark(m))
        .collect()
}

fn aligned(display: &DisplayVerse) -> AlignedVerse {
    aligned_where(display, |_| true)
}

/// The verse with only the source words `keep` takes; a word left with none is unaligned.
fn aligned_where(display: &DisplayVerse, keep: impl Fn(&DisplaySource) -> bool) -> AlignedVerse {
    let mut verse = AlignedVerse::new();
    let ids: Vec<_> = display
        .groups
        .iter()
        .map(|group| {
            let sources: Vec<SourceWord> = group
                .iter()
                .filter(|s| keep(s))
                .map(|s| SourceWord::new(s.content.clone(), s.occurrence))
                .collect();
            (!sources.is_empty()).then(|| verse.add_alignment(sources))
        })
        .collect();
    for token in &display.tokens {
        if token.word {
            // Every kept group was added above, so its id is known to the verse; a group with
            // no source left (`keep` took none, or its `\zaln-s` was unreadable) has none, and
            // its words stay unaligned, which tc-helps reads as it read an empty alignment.
            let _ = verse.push_word(
                token.text.clone(),
                token.group.and_then(|g| ids.get(g).copied().flatten()),
            );
        } else {
            verse.push_text(token.text.clone());
        }
    }
    verse
}

/// What the walk over a book's segments carries from one segment to the next.
#[derive(Debug, Default)]
struct PaneWalk {
    /// The number the last `\c` gave.
    chapter: Option<u16>,
    /// The paragraph marks after the previous verse's text.
    trailing: Vec<String>,
    /// Whether a `\ts\*` came since the previous verse marker.
    section_mark: bool,
}

/// A verse the walk placed in its chapter.
struct WalkedVerse<'a> {
    chapter: u16,
    from: u16,
    to: u16,
    key: RefPart,
    body: &'a str,
    /// The level of the first paragraph mark inside the verse's text.
    lead: Option<u8>,
    /// The level of the paragraph mark before the verse: its own leading marks', else the
    /// previous verse's trailing ones'.
    before: Option<u8>,
    starts_section: bool,
}

impl PaneWalk {
    /// The transition: a `\c` resets what the walk carries, and a verse is placed.
    fn step<'a>(&mut self, segment: &SegmentKind<'a>) -> Option<WalkedVerse<'a>> {
        match segment {
            SegmentKind::Header => None,
            SegmentKind::Chapter(mark) => {
                self.chapter = mark.number();
                self.trailing.clear();
                self.section_mark = false;
                None
            }
            SegmentKind::Verse(unit) => self.verse(unit),
        }
    }

    fn verse<'a>(&mut self, unit: &VerseUnit<'a>) -> Option<WalkedVerse<'a>> {
        // A verse in no chapter is not shown and leaves what the walk carries alone; a verse
        // whose label is no verse number still ends the paragraph and section it sits in.
        let chapter = unit.chapter().or(self.chapter)?;
        let label = unit.label();
        let body = unit.body();
        let leading = unit.leading();
        let (lead, tail) = tc_usfm::edge_markers(body);
        let before = para_marks(leading)
            .last()
            .map(|m| level(m))
            .or_else(|| self.trailing.last().map(|m| level(m)));
        let starts_section = self.section_mark || leading.contains("\\ts\\*");
        self.trailing = tail
            .into_iter()
            .filter(|m| is_para_mark(m))
            .map(str::to_owned)
            .collect();
        self.section_mark = body.contains("\\ts\\*");
        let (from, to) = verse_range(label)?;
        let key = RefPart::parse(label).ok()?;
        Some(WalkedVerse {
            chapter,
            from,
            to,
            key,
            body,
            lead: lead.iter().find(|m| is_para_mark(m)).map(|m| level(m)),
            before,
            starts_section,
        })
    }
}

/// A source book cut into what its pane shows.
pub fn pane_book(usfm: &str) -> PaneBook {
    let book = Book::parse(usfm);
    let mut out = PaneBook::default();
    let mut walk = PaneWalk::default();
    for verse in book.segments().iter().filter_map(|s| walk.step(s.kind())) {
        let display = tc_usfm::display_tokens(verse.body);
        let model = out.chapters.entry(verse.chapter).or_default();
        if (model.verses.is_empty() || verse.starts_section)
            && !model.sections.contains(&verse.from)
        {
            model.sections.push(verse.from);
            model.sections.sort_unstable();
        }
        model.verses.push(VerseModel {
            key: verse.key.clone(),
            from: verse.from,
            to: verse.to,
            view: PaneVerse {
                key: verse.key,
                text: tc_usfm::display_text(verse.body),
                tokens: display.tokens.iter().map(|t| t.text.clone()).collect(),
                lead: verse.lead,
                before: verse.before,
            },
            aligned: aligned(&display),
            reading: SpanReading::of(display, verse.chapter, verse.from, verse.to),
        });
    }
    for model in out.chapters.values_mut() {
        model.verses.sort_by_key(|v| v.from);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A verse whose label is no verse number (`\v 1a`) is not shown, yet a `\ts\*` inside it
    /// still starts a section at the next verse.
    #[test]
    fn a_verse_with_an_unreadable_label_still_ends_its_section() {
        let book =
            pane_book("\\id 3JN\n\\c 1\n\\p\n\\v 1 one\n\\v 1a two \\ts\\* three\n\\v 2 four\n");
        let chapter = &book.chapters[&1];
        let keys: Vec<&str> = chapter.verses.iter().map(|v| v.key.as_str()).collect();
        assert_eq!(keys, ["1", "2"]);
        assert_eq!(chapter.sections, [1, 2]);
    }

    /// The control for the test above: with no `\ts\*`, verse 2 is in verse 1's section.
    #[test]
    fn a_verse_with_no_section_mark_before_it_stays_in_the_section() {
        let book = pane_book("\\id 3JN\n\\c 1\n\\p\n\\v 1 one\n\\v 1a two three\n\\v 2 four\n");
        assert_eq!(book.chapters[&1].sections, [1]);
    }
}
