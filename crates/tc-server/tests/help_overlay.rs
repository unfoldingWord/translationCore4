//! The help pages as this app serves them name its own projects folder and download page, not
//! tC4 4.0's (H16), and no link sends the Help panel to the app's own root (#1031), while the
//! vendored files stay the bytes `help-pages.txt` lists.
#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    reason = "test code: a failed unwrap is a failed test"
)]

use std::path::PathBuf;

use tc_server::{HELP_OVERLAY, help_overlay};

fn vendored(page: &str) -> Vec<u8> {
    let help = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../tc-ui/help");
    std::fs::read(help.join(page)).unwrap_or_else(|e| panic!("{page}: {e}"))
}

fn served(page: &str) -> String {
    String::from_utf8(help_overlay(page, vendored(page))).unwrap()
}

#[test]
fn help_pages_name_the_real_projects_folder() {
    for page in [
        "st-where-projects-live.html",
        "search-index.json",
        "search-index.js",
    ] {
        let text = served(page);
        assert!(
            text.contains("translationCore4/projects"),
            "{page} does not name ~/translationCore4/projects"
        );
        assert!(
            !text.contains("pankosmia") && !text.contains("tc4-projects"),
            "{page} still names tC4 4.0's folder"
        );
    }
}

/// The install page's download link is translationcore.com's download page itself, not its
/// old address `/tc4`, which redirects (#1031), nor tC4's GitHub releases (H16 part 3).
#[test]
fn the_install_page_links_to_the_desktop_download_page() {
    let install = served("gs-install.html");
    assert!(install.contains("href=\"https://translationcore.com/desktop/\""));
    assert!(!install.contains("translationcore.com/tc4"));
    assert!(!install.contains("translationCore4/releases"));
}

fn page(path: &str, html: &str) -> String {
    String::from_utf8(help_overlay(path, html.as_bytes().to_vec())).unwrap()
}

/// A page's `href="/…"` names translationcore.com, where the pages are published. In the app
/// it would load the app's own root in the Help panel (#1031): the help folder's links stay in
/// the panel, relative to the page, and the rest name the site, which opens in the browser.
#[test]
fn a_site_link_in_a_help_page_never_names_the_apps_own_root() {
    let cases = [
        (
            "<a href=\"/\">",
            "<a href=\"https://translationcore.com/\">",
        ),
        (
            "<a class=\"x\" href=\"/desktop/#mac\">",
            "<a class=\"x\" href=\"https://translationcore.com/desktop/#mac\">",
        ),
        ("<a href=\"/tc-help/\">", "<a href=\"index.html\">"),
        ("<a href=\"/tc-help\">", "<a href=\"index.html\">"),
        ("<a href=\"/tc-help/#top\">", "<a href=\"index.html#top\">"),
        (
            "<a href=\"/tc-help/gs-install\">",
            "<a href=\"gs-install\">",
        ),
        (
            "<a href=\"/tc-help/search?q=x\">",
            "<a href=\"search?q=x\">",
        ),
        // Another site's folder that only starts the same way.
        (
            "<a href=\"/tc-helpers\">",
            "<a href=\"https://translationcore.com/tc-helpers\">",
        ),
        // Already another origin, not a link, or not root-absolute: as it is.
        (
            "<a href=\"//cdn.example/x\">",
            "<a href=\"//cdn.example/x\">",
        ),
        ("<a data-href=\"/\">", "<a data-href=\"/\">"),
        ("<a href=\"gs-install\">", "<a href=\"gs-install\">"),
        ("<p>href=\"/\"</p>", "<p>href=\"/\"</p>"),
    ];
    for (html, want) in cases {
        assert_eq!(page("index.html", html), want, "{html}");
    }
    // Every link of a page, wherever it stands.
    assert_eq!(
        page(
            "index.html",
            "<a href=\"/\">a</a>\n<a\thref=\"/tc-help/\">b</a>"
        ),
        "<a href=\"https://translationcore.com/\">a</a>\n<a\thref=\"index.html\">b</a>"
    );
    // A page below the folder climbs back up to it.
    assert_eq!(
        page("sub/page.html", "<a href=\"/tc-help/\">"),
        "<a href=\"../index.html\">"
    );
}

/// Only a page's links are rewritten: a style sheet or a script is served as it is.
#[test]
fn a_help_file_that_is_not_a_page_is_served_as_it_is() {
    let html = b"<a href=\"/\">".to_vec();
    assert_eq!(help_overlay("assets/search.js", html.clone()), html);
    let bytes = vendored("assets/style.css");
    assert_eq!(help_overlay("assets/style.css", bytes.clone()), bytes);
}

/// A re-vendored page whose words moved would leave tC4's folder in place unnoticed.
#[test]
fn every_help_overlay_rule_finds_its_words_in_the_vendored_page() {
    for (page, from, _) in HELP_OVERLAY {
        let text = String::from_utf8(vendored(page)).unwrap();
        assert!(text.contains(from), "{page} no longer holds {from:?}");
    }
}
