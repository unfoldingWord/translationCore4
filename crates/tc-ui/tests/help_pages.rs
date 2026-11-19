//! The files under `help/` are translationcore.com's help as translationCore-Suite-website
//! builds it at the commit this build pins, byte for byte (`vendor-help.sh`, APP-DESIGN AD29,
//! #1031, #1036): English, one folder for each other help language an app language shows, and
//! the site's own files those pages load. `help-pages.txt` names each file by the git blob id
//! of its bytes (tC4 #741's "help sha-list check"). The site holds the pages as sources, so
//! the ids are those of its build: `vendor-help.sh` at the same commit writes the same list.
#![cfg(not(target_arch = "wasm32"))]
#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    reason = "test code: a failed unwrap is a failed test"
)]

use std::collections::BTreeSet;
use std::path::{Path, PathBuf};

use sha1::{Digest, Sha1};
use tc_ui::i18n::LOCALES;

/// The merge of translationCore-Suite-website's localized help (its PR #11, #1036).
const HELP_PIN: &str = "835fb965a322bc3800b61e95f4d2518010f3dd5a";

/// The folders of the English help that hold what every language shows, and the folder of the
/// site's own files. Every other folder under `help/` is a language's.
const SHARED_FOLDERS: [&str; 3] = ["assets", "img", "site"];

/// The site's script that sends a reader to the computer's language. Every page names it;
/// `vendor-help.sh` does not copy it, and tc-server serves each page without its tag.
const NOT_COPIED: &str = "site/assets/js/locale.js";

fn crate_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
}

fn git_blob_id(bytes: &[u8]) -> String {
    let mut h = Sha1::new();
    h.update(format!("blob {}\0", bytes.len()).as_bytes());
    h.update(bytes);
    h.finalize().iter().map(|b| format!("{b:02x}")).collect()
}

struct List {
    repository: String,
    commit: String,
    files: Vec<(String, String)>,
}

fn list() -> List {
    let text = std::fs::read_to_string(crate_dir().join("help-pages.txt")).unwrap();
    let (mut repository, mut commit, mut files) = (None, None, Vec::new());
    for line in text.lines().filter(|l| !l.starts_with('#')) {
        if let Some(r) = line.strip_prefix("repository ") {
            repository = Some(r.to_owned());
        } else if let Some(c) = line.strip_prefix("commit ") {
            commit = Some(c.to_owned());
        } else {
            let (blob, path) = line
                .split_once(' ')
                .unwrap_or_else(|| panic!("not `<blob> <path>`: {line:?}"));
            assert!(
                blob.len() == 40 && blob.bytes().all(|b| b.is_ascii_hexdigit()),
                "not a blob id: {line:?}"
            );
            files.push((blob.to_owned(), path.to_owned()));
        }
    }
    List {
        repository: repository.expect("a repository line"),
        commit: commit.expect("a commit line"),
        files,
    }
}

fn files_under(dir: &Path, base: &Path, out: &mut BTreeSet<String>) {
    for entry in std::fs::read_dir(dir).unwrap() {
        let path = entry.unwrap().path();
        if path.is_dir() {
            files_under(&path, base, out);
        } else {
            let rel = path.strip_prefix(base).unwrap().to_string_lossy();
            out.insert(rel.replace('\\', "/"));
        }
    }
}

/// Every file under `help/`, by its path there.
fn help_files() -> BTreeSet<String> {
    let help = crate_dir().join("help");
    let mut all = BTreeSet::new();
    files_under(&help, &help, &mut all);
    all
}

fn help_text(path: &str) -> String {
    std::fs::read_to_string(crate_dir().join("help").join(path))
        .unwrap_or_else(|e| panic!("help/{path}: {e}"))
}

#[test]
fn every_help_page_has_the_bytes_the_site_has_at_the_pin() {
    let list = list();
    assert_eq!(
        list.repository,
        "https://github.com/unfoldingWord/translationCore-Suite-website.git"
    );
    assert_eq!(list.commit, HELP_PIN);
    let help = crate_dir().join("help");
    let mut listed = BTreeSet::new();
    for (blob, path) in &list.files {
        let bytes = std::fs::read(help.join(path))
            .unwrap_or_else(|e| panic!("help/{path} is listed but cannot be read: {e}"));
        assert_eq!(&git_blob_id(&bytes), blob, "help/{path} is not the site's");
        assert!(listed.insert(path.clone()), "help/{path} is listed twice");
    }
    let unlisted: Vec<_> = help_files().difference(&listed).cloned().collect();
    assert!(
        unlisted.is_empty(),
        "files under help/ that help-pages.txt does not list: {unlisted:?}"
    );
    assert_eq!(
        list.files.len(),
        966,
        "the build at the pin gives 210 English files, 90 in each of 8 languages and 36 of the site's own"
    );
}

#[test]
fn the_help_home_is_the_pages_index() {
    let index = help_text("index.html");
    assert!(index.contains("<title>Home · translationCore 4 Help</title>"));
    assert!(index.contains("assets/style.css"));
}

/// Help and guides opens the help of the app's language (#1036). Each app language names its
/// help folder, or none for the English help; the folders vendored are exactly the ones
/// named, so no language is vendored that the app cannot show, and none is named that is not
/// there. A language folder holds every page the English help holds.
#[test]
fn the_help_languages_are_the_ones_the_app_languages_show() {
    let files = help_files();
    let folders: BTreeSet<&str> = files
        .iter()
        .filter_map(|path| path.split_once('/'))
        .map(|(folder, _)| folder)
        .filter(|folder| !SHARED_FOLDERS.contains(folder))
        .collect();
    let shown: BTreeSet<&str> = LOCALES.iter().filter_map(|l| l.help).collect();
    assert_eq!(folders, shown);
    assert_eq!(shown.len(), 8, "es, fr, hi, pt, id, ru, vi and ar");

    let english: BTreeSet<&str> = files
        .iter()
        .filter(|path| !path.contains('/') && path.ends_with(".html"))
        .map(String::as_str)
        .collect();
    assert!(english.len() > 80, "only {} English pages", english.len());
    for locale in LOCALES {
        let home = locale.help_home();
        let home = home.strip_prefix("/help/").expect("a help address");
        assert!(files.contains(home), "{}: no help/{home}", locale.id);
        let Some(folder) = locale.help else {
            continue;
        };
        let pages: BTreeSet<&str> = files
            .iter()
            .filter_map(|path| path.strip_prefix(folder)?.strip_prefix('/'))
            .filter(|page| page.ends_with(".html"))
            .collect();
        assert_eq!(pages, english, "help/{folder}/ and the English pages");
    }
    // English, and a language translationcore.com has no help in, show the English help.
    for id in ["en", "uk"] {
        let locale = LOCALES.iter().find(|l| l.id == id).unwrap();
        assert_eq!(locale.help_home(), "/help/index.html", "{id}");
    }
    let spanish = LOCALES.iter().find(|l| l.id == "es-419").unwrap();
    assert_eq!(spanish.help_home(), "/help/es/index.html");
}

/// A help home says its language and direction, as the site tags them (#1036).
#[test]
fn a_help_home_says_its_language_and_direction() {
    for (folder, tag) in [
        ("", "<html lang=\"en\" dir=\"ltr\""),
        ("es/", "<html lang=\"es-MX\" dir=\"ltr\""),
        ("pt/", "<html lang=\"pt-BR\" dir=\"ltr\""),
        ("ar/", "<html lang=\"ar\" dir=\"rtl\""),
    ] {
        let home = help_text(&format!("{folder}index.html"));
        assert!(home.contains(tag), "help/{folder}index.html is not {tag}>");
    }
}

/// The site's own files under `help/site/` are exactly the ones a vendored page loads from
/// the site's `/assets/`, and the font files exactly the ones those style sheets name: only
/// the fonts of the scripts the vendored languages need (#1036).
#[test]
fn only_the_site_files_and_fonts_the_pages_load_are_vendored() {
    let files = help_files();
    let in_page = regex::Regex::new(r#"\s(?:href|src)="(/assets/[^"?#]+)"#).unwrap();
    let in_css = regex::Regex::new(r"url\((/assets/[^)?#]+)\)").unwrap();
    let mut named = BTreeSet::new();
    let mut pages = 0;
    for path in files.iter().filter(|path| path.ends_with(".html")) {
        pages += 1;
        let text = help_text(path);
        assert!(
            text.contains("<script src=\"/assets/js/locale.js\"></script>"),
            "help/{path} does not hold the tag tc-server serves it without"
        );
        named.extend(
            in_page
                .captures_iter(&text)
                .map(|m| format!("site{}", &m[1])),
        );
    }
    assert!(pages > 800, "only {pages} pages read");
    assert!(named.remove(NOT_COPIED), "no page names {NOT_COPIED}");
    for path in files.iter().filter(|path| path.ends_with(".css")) {
        let text = help_text(path);
        named.extend(
            in_css
                .captures_iter(&text)
                .map(|m| format!("site{}", &m[1])),
        );
    }
    let vendored: BTreeSet<String> = files
        .iter()
        .filter(|path| path.starts_with("site/"))
        .cloned()
        .collect();
    assert_eq!(vendored, named);
    let fonts: Vec<_> = vendored
        .iter()
        .filter(|path| path.contains("/fonts/") && path.ends_with(".css"))
        .collect();
    assert_eq!(
        fonts,
        [
            "site/assets/fonts/arabic.css",
            "site/assets/fonts/devanagari.css"
        ],
        "the font packs of Arabic and Hindi; the other languages use the reader's own fonts"
    );
}

/// THIRD-PARTY-NOTICES.txt carries the licence of every font the help loads (#1036):
/// `scripts/release/notices.mjs` copies each `OFL-*.txt` of the app's two font folders into
/// it, and each font family a vendored style sheet declares has its text there.
#[test]
fn the_notices_carry_the_licence_of_every_help_font() {
    let family = regex::Regex::new(r"font-family:\s*'([^']+)'").unwrap();
    let mut families = BTreeSet::new();
    for path in help_files() {
        if path.starts_with("site/assets/fonts/") && path.ends_with(".css") {
            let text = help_text(&path);
            families.extend(family.captures_iter(&text).map(|m| m[1].to_owned()));
        }
    }
    assert_eq!(
        families.iter().map(String::as_str).collect::<Vec<_>>(),
        ["Noto Sans Arabic", "Noto Sans Devanagari"]
    );
    for family in families {
        let name = format!("OFL-{}.txt", family.replace(' ', ""));
        let text = ["assets/ds/assets/fonts", "assets/ds-rebuild/fonts"]
            .iter()
            .find_map(|dir| std::fs::read_to_string(crate_dir().join(dir).join(&name)).ok())
            .unwrap_or_else(|| panic!("no {name} in the font folders the notices read"));
        assert!(
            text.contains("SIL Open Font License, Version 1.1"),
            "{name} is not the OFL 1.1"
        );
    }
}

/// The pages load nothing from another origin, so opening help sends nothing over the
/// internet (tC4's help case b). A link to another site is a navigation, which the internet
/// question guards. A page's `<link rel="canonical">` and `<link rel="alternate">` name its
/// address on translationcore.com in each language; a browser loads neither.
#[test]
fn help_pages_load_nothing_from_another_origin() {
    let remote = regex::Regex::new(
        r#"(?i)(<script[^>]*\ssrc\s*=\s*["']?(https?:)?//|<link[^>]*\shref\s*=\s*["']?(https?:)?//|<img[^>]*\ssrc\s*=\s*["']?(https?:)?//|url\(\s*["']?(https?:)?//|@import\s+["']?(https?:)?//)"#,
    )
    .unwrap();
    let names_the_page =
        regex::Regex::new(r#"<link rel="(?:canonical|alternate)" (?:hreflang="[^"]*" )?href="https://translationcore\.com/[^"]*">"#)
            .unwrap();
    let mut checked = 0;
    for path in help_files() {
        if !(path.ends_with(".html") || path.ends_with(".css") || path.ends_with(".js")) {
            continue;
        }
        let text = help_text(&path);
        let text = names_the_page.replace_all(&text, "");
        assert!(
            !remote.is_match(&text),
            "help/{path} loads something from another origin"
        );
        checked += 1;
    }
    assert!(
        checked > 800,
        "only {checked} pages and style sheets checked"
    );
}
