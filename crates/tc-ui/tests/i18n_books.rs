//! Book names (#1043): the English catalog names each book as tc-core's table does, and every
//! label takes a book's name from `i18n::book_name`, in the shown language.
//!
//! The language state is per thread and each test runs on its own thread, so a test starts in
//! English with only English installed. No test writes a real translated name (ruling H10):
//! [`stand_in`] gives a book a name no language has.
#![cfg(not(target_arch = "wasm32"))]
#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    reason = "test code: a failed unwrap is a failed test"
)]

use std::collections::BTreeSet;
use std::path::PathBuf;

use serde_json::{Map, Value};
use tc_api::create::UsfmProblem;
use tc_api::ids::LocaleId;
use tc_core::BookId;
use tc_ui::app::forms::problem_words;
use tc_ui::app::outside::name_of;
use tc_ui::app::understand::ref_label;
use tc_ui::i18n::{Catalog, book_key, book_name, install_catalog, show_locale};

fn read(file: &str) -> String {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("assets")
        .join(file);
    std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("cannot read {}: {e}", path.display()))
}

/// The rebuild's own file of a language, as it is on disk.
fn rebuild(id: &str) -> Map<String, Value> {
    match serde_json::from_str(&read(&format!("i18n-rebuild/{id}.json"))) {
        Ok(Value::Object(map)) => map,
        other => panic!("i18n-rebuild/{id}.json is not a JSON object: {other:?}"),
    }
}

/// A name that stands in for a translated one.
fn stand_in(book: BookId) -> String {
    format!("«{}»", book.code())
}

/// Shows French with `names` as its book names over the shipped catalog; a book that `names`
/// leaves out has no French name.
fn show_french_with(names: impl Fn(BookId) -> Option<String>) {
    let mut own = rebuild("fr");
    for book in BookId::ALL {
        let key = book_key(book).as_str();
        match names(book) {
            Some(name) => own.insert(key.to_owned(), Value::String(name)),
            None => own.remove(key),
        };
    }
    let french = LocaleId::parse("fr").unwrap();
    let catalog = Catalog::parse(&read("i18n/fr.json"), &Value::Object(own).to_string()).unwrap();
    install_catalog(french, catalog);
    assert!(show_locale(french));
}

#[test]
#[expect(
    clippy::disallowed_methods,
    reason = "the one comparison of the catalog with tc-core's English table"
)]
fn the_english_catalog_names_each_book_as_tc_core_does() {
    let english = rebuild("en");
    let in_catalog: BTreeSet<&str> = english
        .keys()
        .map(String::as_str)
        .filter(|key| key.starts_with("book."))
        .collect();
    assert_eq!(in_catalog.len(), 66, "one key per book");
    let mut of_books = BTreeSet::new();
    for book in BookId::ALL {
        let key = book_key(book).as_str();
        assert_eq!(
            english.get(key).and_then(Value::as_str),
            Some(book.english_name()),
            "{key}"
        );
        of_books.insert(key);
    }
    assert_eq!(
        of_books, in_catalog,
        "each book has its own key, and no book key is left over"
    );
}

#[test]
fn a_book_is_named_in_the_shown_language() {
    assert_eq!(book_name(BookId::Titus), "Titus");
    show_french_with(|book| Some(stand_in(book)));
    for book in BookId::ALL {
        assert_eq!(book_name(book), stand_in(book));
    }
    assert!(show_locale(LocaleId::ENGLISH));
    assert_eq!(book_name(BookId::FirstSamuel), "1 Samuel");
}

#[test]
fn a_book_not_named_yet_shows_in_english() {
    show_french_with(|book| (book == BookId::Jude).then(|| stand_in(book)));
    assert_eq!(book_name(BookId::Jude), "«JUD»");
    assert_eq!(book_name(BookId::Titus), "Titus");
    assert_eq!(ref_label(BookId::SongofSongs, 8, &[]), "Song of Songs 8");
}

#[test]
fn a_label_keeps_western_digits_after_the_name() {
    show_french_with(|book| Some(stand_in(book)));
    assert_eq!(ref_label(BookId::Titus, 2, &[]), "«TIT» 2");
    assert_eq!(
        ref_label(BookId::Titus, 2, &["13".to_owned()]),
        "«TIT» 2:13"
    );
    assert_eq!(name_of("57-TIT.usfm", Some(BookId::Titus)), "«TIT»");
}

/// The sentence of a file whose book the project holds comes from tc-api's key and values; the
/// interface names the book.
#[test]
fn a_refused_file_names_its_book_in_the_shown_language() {
    let held = UsfmProblem::Exists { book: BookId::Jude };
    let sentence = |id: &str, name: &str| {
        let text = rebuild(id)["addBook.usfmExistsUpdate"]
            .as_str()
            .unwrap()
            .to_owned();
        assert!(text.contains("{name}"), "{id}: {text}");
        text.replace("{name}", name)
    };
    assert_eq!(problem_words(&held, "JUD.usfm"), sentence("en", "Jude"));
    show_french_with(|book| Some(stand_in(book)));
    assert_eq!(problem_words(&held, "JUD.usfm"), sentence("fr", "«JUD»"));
    assert_ne!(sentence("fr", "x"), sentence("en", "x"));
}
