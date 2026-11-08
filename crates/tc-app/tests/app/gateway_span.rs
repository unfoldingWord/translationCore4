//! A help on one verse of a gateway verse span (`\v 6-7`) lights and titles only the gateway
//! words aligned to that verse, read from each word's `x-ref` (#409). J4 (Check a book with
//! tN and tW) and J16 (Read a passage with helps) show these.

use std::io::Read;

use tc_app::sources::{PaneBook, pane_book};
use tc_helps::{Occurrence, Quote};

fn bundle_entry(archive: &str, entry: &str) -> String {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../bundle/en")
        .join(archive);
    let mut zip = zip::ZipArchive::new(std::fs::File::open(path).unwrap()).unwrap();
    let mut text = String::new();
    zip.by_name(entry)
        .unwrap()
        .read_to_string(&mut text)
        .unwrap();
    text
}

/// en_ust 3 John: its 1:6-7 is one gateway verse whose words name their verse by `x-ref`.
fn ust_3jn() -> PaneBook {
    pane_book(&bundle_entry(
        "en_ust_v91.sb.zip",
        "en_ust/ingredients/3JN.usfm",
    ))
}

/// The gateway words a help at `verse` lights, and the title it gets.
fn lit(book: &PaneBook, verse: &str, quote: &str) -> (Option<String>, Vec<String>) {
    let chapter = &book.chapters[&1];
    let (title, lit) = chapter.focus(verse, &Quote::new(quote), Occurrence::nth(1).unwrap());
    let words = lit
        .iter()
        .flat_map(|l| {
            let model = chapter.verses.iter().find(|m| m.key == l.verse).unwrap();
            l.tokens
                .iter()
                .map(|&t| model.view.tokens[t as usize].clone())
                .collect::<Vec<_>>()
        })
        .collect();
    (title, words)
}

/// `x-ref` taken out of every word, as in a span aligned before `x-ref` existed.
fn without_x_ref(usfm: &str) -> String {
    let mut out = String::with_capacity(usfm.len());
    let mut rest = usfm;
    while let Some(at) = rest.find(" x-ref=\"") {
        out.push_str(&rest[..at]);
        let after = &rest[at + " x-ref=\"".len()..];
        rest = &after[after.find('"').unwrap() + 1..];
    }
    out.push_str(rest);
    out
}

/// en_tn 3JN 1:7 quotes ὑπὲρ & τοῦ ὀνόματος. The span's other τοῦ is 1:6's, rendered "God",
/// and must not light or join the title.
#[test]
fn a_help_on_one_verse_of_a_gateway_span_lights_only_that_verses_words() {
    let book = ust_3jn();
    let (title, words) = lit(&book, "7", "ὑπὲρ & τοῦ ὀνόματος");
    assert_eq!(
        words,
        ["in", "order", "to", "be", "obedient", "to", "Jesus"],
        "{title:?}"
    );
    assert_eq!(title.as_deref(), Some("in order to be obedient to Jesus"));
}

/// τοῦ occurs once in 1:6 and once in 1:7; each verse's help finds its own.
#[test]
fn a_word_in_both_verses_of_a_gateway_span_lights_in_the_helps_verse() {
    let book = ust_3jn();
    assert_eq!(lit(&book, "6", "τοῦ").1, ["God"]);
    assert_eq!(lit(&book, "7", "τοῦ").1, ["Jesus"]);
}

/// A help on the whole span reads every word of it: no word is left out. tc-helps counts a
/// word's occurrence with no verse, so τοῦ 1 lights in both verses; that predates #409.
#[test]
fn a_help_on_the_whole_gateway_span_lights_both_verses() {
    assert_eq!(lit(&ust_3jn(), "6-7", "τοῦ").1, ["Jesus", "God"]);
}

/// With no `x-ref` nothing tells the verses apart, so the whole span is read, as before.
#[test]
fn a_gateway_span_without_x_ref_lights_as_one_verse() {
    let usfm = bundle_entry("en_ust_v91.sb.zip", "en_ust/ingredients/3JN.usfm");
    let book = pane_book(&without_x_ref(&usfm));
    assert_eq!(lit(&book, "7", "τοῦ").1, ["Jesus", "God"]);
    assert_eq!(lit(&book, "6", "τοῦ").1, ["Jesus", "God"]);
}

/// One source word without `x-ref` leaves a word of the span with no known verse, so the
/// span is read whole rather than lose that word from every help.
#[test]
fn a_gateway_span_with_one_word_lacking_x_ref_lights_as_one_verse() {
    let usfm = bundle_entry("en_ust_v91.sb.zip", "en_ust/ingredients/3JN.usfm");
    let one = "x-content=\"ὑπὲρ\" x-ref=\"1:7\"";
    assert_eq!(usfm.matches(one).count(), 1);
    let book = pane_book(&usfm.replace(one, "x-content=\"ὑπὲρ\""));
    assert_eq!(lit(&book, "7", "τοῦ").1, ["Jesus", "God"]);
}

/// A source word whose `x-ref` names a verse outside the span (1:8 in `\v 6-7`) has no verse
/// a help on the span can be on, so the span is read whole rather than lose that word.
#[test]
fn a_gateway_span_with_an_x_ref_outside_it_lights_as_one_verse() {
    let usfm = bundle_entry("en_ust_v91.sb.zip", "en_ust/ingredients/3JN.usfm");
    let one = "x-content=\"ὑπὲρ\" x-ref=\"1:7\"";
    assert_eq!(usfm.matches(one).count(), 1);
    let book = pane_book(&usfm.replace(one, "x-content=\"ὑπὲρ\" x-ref=\"1:8\""));
    assert_eq!(lit(&book, "7", "τοῦ").1, ["Jesus", "God"]);
}
