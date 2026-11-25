//! The quotation marks around a phrase that is content, not interface text (#1075): the phrase
//! of a check in its heading and on its row of the Check list, the phrase of a note card, the
//! reference on Align.
//!
//! The marks are the interface language's ([`Locale::marks`]): the ones its catalog puts
//! around `{quote}` in `check.next`, which a test here reads from the ten catalogs. The phrase
//! may read the other way from the interface: an Arabic phrase under an English interface, an
//! English one under Arabic. So [`Quoted`] carries the direction of the phrase with the text,
//! and the place that shows it gives that direction to the marks and the phrase together
//! ([`Quoted::inline`], or the `dir` of a block that holds nothing else). The browser is never
//! asked to find the direction (`dir="auto"`): the order of the two marks depends on it, so one
//! function decides both.

use crate::i18n::{Locale, TextDir, locale_of, shown_locale};

/// The pair of quotation marks an interface language puts around a quoted phrase.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Marks {
    /// “…”
    Curly,
    /// «…»
    Guillemets,
    /// « … »: French sets a space between each mark and the phrase.
    SpacedGuillemets,
}

impl Marks {
    /// The opening mark and the closing mark, each with the space that belongs to it. The
    /// space is a no-break space, where the catalog has a plain one: a line then never ends
    /// with « or starts with ».
    pub const fn pair(self) -> (&'static str, &'static str) {
        match self {
            Marks::Curly => ("\u{201C}", "\u{201D}"),
            Marks::Guillemets => ("\u{AB}", "\u{BB}"),
            Marks::SpacedGuillemets => ("\u{AB}\u{A0}", "\u{A0}\u{BB}"),
        }
    }

    /// Whether a right-to-left line draws each mark as its mirror image (Unicode
    /// `Bidi_Mirrored`): « and » are drawn so, “ and ” keep their shape.
    const fn mirrored(self) -> bool {
        match self {
            Marks::Curly => false,
            Marks::Guillemets | Marks::SpacedGuillemets => true,
        }
    }
}

/// A phrase between quotation marks, and the direction the whole reads in.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Quoted {
    /// The mark that comes first in the text. Laid out in `dir`, it is drawn before the first
    /// word of the phrase.
    pub first: &'static str,
    /// The phrase, as it was given.
    pub phrase: String,
    /// The mark that comes last in the text, drawn after the last word of the phrase.
    pub last: &'static str,
    /// The direction of the phrase.
    pub dir: TextDir,
}

impl Quoted {
    /// The two marks and the phrase as one text.
    pub fn text(&self) -> String {
        [self.first, &self.phrase, self.last].concat()
    }
}

/// Which way `text` reads: the direction of its first letter, as `dir="auto"` takes the first
/// character that has a direction. Digits, punctuation and spaces have none.
pub fn direction_of(text: &str) -> Option<TextDir> {
    text.chars().find(|c| c.is_alphabetic()).map(|c| {
        if is_right_to_left(c) {
            TextDir::Rtl
        } else {
            TextDir::Ltr
        }
    })
}

/// A character of a right-to-left script: Hebrew, Arabic, Syriac, Thaana, N'Ko and the others
/// that Unicode gives the bidi classes R and AL, by the ranges UAX #9 reserves for them.
fn is_right_to_left(c: char) -> bool {
    matches!(
        u32::from(c),
        0x0590..=0x08FF | 0xFB1D..=0xFDFF | 0xFE70..=0xFEFF | 0x10800..=0x10FFF | 0x1E800..=0x1EFFF
    )
}

/// `phrase` between the marks of `locale`. A phrase with no letter (a number, such as
/// "32,000") reads left to right, as `dir="auto"` reads it under any interface.
pub fn quote(locale: &Locale, phrase: &str) -> Quoted {
    let dir = direction_of(phrase).unwrap_or(TextDir::Ltr);
    let (open, close) = locale.marks.pair();
    // A right-to-left line draws its first character at the right end. « is mirrored there, so
    // it still opens toward the phrase. “ keeps its shape, so the two change places: “ stays
    // at the left end and ” at the right, as a left-to-right line shows them.
    let (first, last) = if dir == TextDir::Rtl && !locale.marks.mirrored() {
        (close, open)
    } else {
        (open, close)
    };
    Quoted {
        first,
        phrase: phrase.to_owned(),
        last,
        dir,
    }
}

/// `phrase` between the marks of the shown interface language. A view that reads it renders
/// again when the language changes.
pub fn quoted(phrase: &str) -> Quoted {
    quote(locale_of(shown_locale()), phrase)
}

#[cfg(target_arch = "wasm32")]
mod view {
    use leptos::prelude::*;

    impl super::Quoted {
        /// The quoted phrase inside a line that reads in the interface's direction: the marks
        /// and the phrase are one isolated run in the phrase's direction, and the line around
        /// it keeps its own direction, its side and where it is cut short. The mark, the
        /// phrase and the mark are three text nodes, as the places had them before: the
        /// browser then draws a phrase that reads as the interface does pixel for pixel as it
        /// did (as one text node, a few letters get other edge pixels).
        pub fn inline(self) -> impl IntoView {
            view! { <bdi dir=self.dir.as_str()>{self.first}{self.phrase}{self.last}</bdi> }
        }
    }
}

// On the host only: the tests read the catalog files and use proptest.
#[cfg(test)]
#[cfg(not(target_arch = "wasm32"))]
mod tests {
    use proptest::prelude::*;

    use tc_api::ids::LocaleId;

    use super::*;
    use crate::i18n::{Catalog, LOCALES, install_catalog, locale, show_locale};

    const ARABIC: &str = "مُخْتَارِي ٱللهِ";
    const ENGLISH: &str = "of the chosen people of God";

    fn of(id: &str) -> &'static Locale {
        locale(id).unwrap_or_else(|| panic!("{id} is an interface language"))
    }

    /// The text and the direction of a quoted phrase.
    fn shown(quoted: &Quoted) -> (String, TextDir) {
        (quoted.text(), quoted.dir)
    }

    /// `check.next` of an interface language, cut at `{quote}`.
    fn check_next(id: &str) -> (String, String) {
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("assets/i18n")
            .join(id)
            .with_extension("json");
        let file = path.display();
        let text =
            std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("cannot read {file}: {e}"));
        let catalog: serde_json::Value =
            serde_json::from_str(&text).unwrap_or_else(|e| panic!("{file} is not JSON: {e}"));
        let message = catalog["check.next"]
            .as_str()
            .unwrap_or_else(|| panic!("{file} has no check.next"));
        let (before, after) = message
            .split_once("{quote}")
            .unwrap_or_else(|| panic!("check.next of {file} has no {{quote}}: {message}"));
        (before.to_owned(), after.to_owned())
    }

    #[test]
    fn inv_quote_marks_follow_interface_each_language_has_the_marks_of_its_check_next() {
        for locale in &LOCALES {
            let (before, after) = check_next(locale.id);
            // The catalog's plain space is the helper's no-break space.
            let (open, close) = locale.marks.pair();
            let (open, close) = (open.replace('\u{A0}', " "), close.replace('\u{A0}', " "));
            assert!(
                before.ends_with(&open),
                "INV-QUOTE-MARKS-FOLLOW-INTERFACE: {} opens with {open:?}, its check.next has {before:?} before {{quote}}",
                locale.id
            );
            assert!(
                after.starts_with(&close),
                "INV-QUOTE-MARKS-FOLLOW-INTERFACE: {} closes with {close:?}, its check.next has {after:?} after {{quote}}",
                locale.id
            );
        }
    }

    #[test]
    fn inv_quote_marks_follow_interface_arabic_russian_ukrainian_and_french_use_guillemets() {
        let guillemets: Vec<_> = LOCALES
            .iter()
            .filter(|l| l.marks != Marks::Curly)
            .map(|l| (l.id, l.marks))
            .collect();
        assert_eq!(
            guillemets,
            [
                ("fr", Marks::SpacedGuillemets),
                ("uk", Marks::Guillemets),
                ("ru", Marks::Guillemets),
                ("ar", Marks::Guillemets),
            ]
        );
    }

    // Case a of #1075: the browser mirrors « and », so they stay in order.
    #[test]
    fn inv_quote_marks_at_phrase_ends_an_arabic_phrase_in_arabic_reads_right_to_left() {
        assert_eq!(
            shown(&quote(of("ar"), ARABIC)),
            (format!("\u{AB}{ARABIC}\u{BB}"), TextDir::Rtl)
        );
    }

    // Case b: the phrase keeps its own direction under a right-to-left interface.
    #[test]
    fn inv_quote_marks_at_phrase_ends_an_english_phrase_in_arabic_reads_left_to_right() {
        assert_eq!(
            shown(&quote(of("ar"), ENGLISH)),
            (format!("\u{AB}{ENGLISH}\u{BB}"), TextDir::Ltr)
        );
    }

    // Case c: what the four places showed before.
    #[test]
    fn inv_quote_marks_at_phrase_ends_an_english_phrase_in_english_is_unchanged() {
        assert_eq!(
            shown(&quote(of("en"), ENGLISH)),
            (format!("\u{201C}{ENGLISH}\u{201D}"), TextDir::Ltr)
        );
    }

    // Case d: U+201D first, so the right-to-left run draws “ at the left end and ” at the right.
    #[test]
    fn inv_quote_marks_at_phrase_ends_curly_marks_change_places_around_a_right_to_left_phrase() {
        for id in ["en", "es-419", "hi", "pt-BR", "id", "vi"] {
            assert_eq!(
                shown(&quote(of(id), ARABIC)),
                (format!("\u{201D}{ARABIC}\u{201C}"), TextDir::Rtl),
                "{id}"
            );
        }
        assert_eq!(quote(of("en"), "בְּרֵאשִׁית").text(), "\u{201D}בְּרֵאשִׁית\u{201C}");
    }

    #[test]
    fn inv_quote_marks_at_phrase_ends_a_french_mark_is_tied_to_its_word() {
        let quoted = quote(of("fr"), ENGLISH);
        assert_eq!(quoted.text(), format!("\u{AB}\u{A0}{ENGLISH}\u{A0}\u{BB}"));
        assert_eq!(quoted.dir, TextDir::Ltr);
        // A right-to-left phrase keeps the same order: the browser mirrors the two marks.
        assert_eq!(
            quote(of("fr"), ARABIC).text(),
            format!("\u{AB}\u{A0}{ARABIC}\u{A0}\u{BB}")
        );
    }

    #[test]
    fn the_direction_of_a_text_is_that_of_its_first_letter() {
        for (text, want) in [
            ("", None),
            ("1:1", None),
            ("… — (12) ٣", None),
            ("Titus 1:1", Some(TextDir::Ltr)),
            ("(Paul)", Some(TextDir::Ltr)),
            ("Παῦλος", Some(TextDir::Ltr)),
            ("पौलुस", Some(TextDir::Ltr)),
            ("Павел", Some(TextDir::Ltr)),
            ("\u{301}a", Some(TextDir::Ltr)),
            ("3 John يوحنا", Some(TextDir::Ltr)),
            ("بُولُسُ", Some(TextDir::Rtl)),
            ("ٱللهِ", Some(TextDir::Rtl)),
            ("3 يوحنا", Some(TextDir::Rtl)),
            ("«שָׁלוֹם»", Some(TextDir::Rtl)),
            ("ܫܠܡܐ", Some(TextDir::Rtl)),
            ("ﭏ", Some(TextDir::Rtl)),
            ("ﻻ", Some(TextDir::Rtl)),
            ("𞤀𞤣𞤤𞤢𞤥", Some(TextDir::Rtl)),
        ] {
            assert_eq!(direction_of(text), want, "{text:?}");
        }
    }

    #[test]
    fn a_phrase_with_no_letter_reads_left_to_right_under_any_interface() {
        assert_eq!(quote(of("en"), "1:1").dir, TextDir::Ltr);
        // A note of the English stories quotes "32,000": its card title stays on the left in
        // the Arabic interface, where `dir="auto"` put it.
        assert_eq!(
            shown(&quote(of("ar"), "32,000")),
            ("\u{AB}32,000\u{BB}".to_owned(), TextDir::Ltr)
        );
        assert_eq!(
            shown(&quote(of("ar"), "")),
            ("\u{AB}\u{BB}".to_owned(), TextDir::Ltr)
        );
    }

    #[test]
    fn the_shown_language_decides_the_marks() {
        assert_eq!(quoted(ENGLISH).text(), format!("\u{201C}{ENGLISH}\u{201D}"));
        let arabic = LocaleId::parse("ar").expect("ar is an interface language");
        install_catalog(arabic, Catalog::default());
        assert!(show_locale(arabic));
        assert_eq!(quoted(ENGLISH).text(), format!("\u{AB}{ENGLISH}\u{BB}"));
    }

    proptest! {
        // The phrase is content: the marks go around it and nothing in it changes.
        #[test]
        fn inv_quote_marks_at_phrase_ends_the_phrase_is_kept_whole_between_the_two_marks(
            index in 0..LOCALES.len(),
            phrase in "\\PC{0,24}",
        ) {
            let locale = &LOCALES[index];
            let (open, close) = locale.marks.pair();
            let quoted = quote(locale, &phrase);
            prop_assert_eq!(&quoted.phrase, &phrase);
            prop_assert_eq!(quoted.text(), format!("{}{phrase}{}", quoted.first, quoted.last));
            // Only “ and ” change places, and only around a right-to-left phrase.
            let changed = locale.marks == Marks::Curly && quoted.dir == TextDir::Rtl;
            prop_assert_eq!(
                (quoted.first, quoted.last),
                if changed { (close, open) } else { (open, close) }
            );
        }
    }
}
