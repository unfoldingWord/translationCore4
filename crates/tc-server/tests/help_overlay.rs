//! The help pages as this app serves them name its own projects folder and download page, not
//! tC4 4.0's (H16), and no address in them names the app's own root (#1031) or a file the app
//! does not have (#1036), in English and in every other language's folder, while the vendored
//! files stay the bytes `help-pages.txt` lists.
#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    reason = "test code: a failed unwrap is a failed test"
)]

use std::path::PathBuf;

use tc_server::{HELP_CUT, HELP_OVERLAY, HelpPage, help_overlay};

fn help_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../tc-ui/help")
}

fn vendored(page: &str) -> Vec<u8> {
    std::fs::read(help_dir().join(page)).unwrap_or_else(|e| panic!("{page}: {e}"))
}

fn served(page: &str) -> String {
    String::from_utf8(help_overlay(page, vendored(page))).unwrap()
}

/// The folder of each help language below the help folder, with its `/`: none for English,
/// whose pages are the help folder's own, then each folder that holds a help home.
fn languages() -> Vec<String> {
    let mut folders = vec![String::new()];
    for entry in std::fs::read_dir(help_dir()).unwrap() {
        let path = entry.unwrap().path();
        if path.join("index.html").is_file() {
            folders.push(format!("{}/", path.file_name().unwrap().to_string_lossy()));
        }
    }
    folders.sort();
    folders
}

#[test]
fn help_pages_name_the_real_projects_folder() {
    let mut pages = vec!["search-index.json".to_owned()];
    for language in languages() {
        pages.push(format!("{language}st-where-projects-live.html"));
        pages.push(format!("{language}search-index.js"));
    }
    for page in pages {
        let text = served(&page);
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
    for language in languages() {
        let page = format!("{language}gs-install.html");
        let install = served(&page);
        assert!(
            install.contains("href=\"https://translationcore.com/desktop/\""),
            "{page}"
        );
        assert!(!install.contains("translationcore.com/tc4"), "{page}");
        assert!(!install.contains("translationCore4/releases"), "{page}");
    }
    assert!(served("gs-install.html").contains(">translationCore download page</a>"));
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

/// A page in another language names its own pages `/{lang}/tc-help/…`, the images and assets
/// every language shares `/tc-help/…`, and the site's own files `/assets/…`, in `href` and in
/// `src` (#1036). Each becomes the file the app serves below `/help/`, relative to the page.
/// The site's home in that language, `/{lang}/`, is the site's.
#[test]
fn a_page_in_another_language_names_the_files_the_app_serves() {
    let cases = [
        ("<a href=\"/es/tc-help/\">", "<a href=\"../es/index.html\">"),
        ("<a href=\"/es/tc-help\">", "<a href=\"../es/index.html\">"),
        (
            "<a href=\"/es/tc-help/gs-install#mac\">",
            "<a href=\"../es/gs-install#mac\">",
        ),
        (
            "<a href=\"/tc-help/img/home.png\"><img src=\"/tc-help/img/home.png\"></a>",
            "<a href=\"../img/home.png\"><img src=\"../img/home.png\"></a>",
        ),
        (
            "<link rel=\"stylesheet\" href=\"/tc-help/assets/style.css\">",
            "<link rel=\"stylesheet\" href=\"../assets/style.css\">",
        ),
        (
            "<link rel=\"stylesheet\" href=\"/assets/fonts/arabic.css\">",
            "<link rel=\"stylesheet\" href=\"../site/assets/fonts/arabic.css\">",
        ),
        (
            "<script src=\"/assets/js/help-i18n.js\"></script>",
            "<script src=\"../site/assets/js/help-i18n.js\"></script>",
        ),
        (
            "<a class=\"site-link\" href=\"/es/\">",
            "<a class=\"site-link\" href=\"https://translationcore.com/es/\">",
        ),
        // The site's folder itself, a page of the site, and a name that is not an attribute.
        (
            "<a href=\"/assets/\">",
            "<a href=\"https://translationcore.com/assets/\">",
        ),
        (
            "<a href=\"/es/desktop/\">",
            "<a href=\"https://translationcore.com/es/desktop/\">",
        ),
        ("<img data-src=\"/x.png\">", "<img data-src=\"/x.png\">"),
        ("<img srcset=\"/x.png 2x\">", "<img srcset=\"/x.png 2x\">"),
    ];
    for (html, want) in cases {
        assert_eq!(page("es/index.html", html), want, "{html}");
    }
    assert_eq!(
        page(
            "index.html",
            "<script src=\"/assets/js/help-i18n.js\"></script>"
        ),
        "<script src=\"site/assets/js/help-i18n.js\"></script>"
    );
}

/// A style sheet of the site names its fonts from the site's root (#1036).
#[test]
fn a_style_sheet_names_the_font_files_the_app_serves() {
    let css = "src: url(/assets/fonts/files/a.woff2) format('woff2'), url(files/b.woff);";
    assert_eq!(
        page("site/assets/fonts/arabic.css", css),
        "src: url(../../../site/assets/fonts/files/a.woff2) format('woff2'), url(files/b.woff);"
    );
    assert_eq!(
        page("assets/style.css", "a { background: url(/x.png) }"),
        "a { background: url(https://translationcore.com/x.png) }"
    );
}

/// Help follows the app's language (#1036): a page is served without the site's language
/// menu, and without the script that sends a reader to the computer's language.
#[test]
fn a_page_is_served_without_the_language_menu_and_the_language_redirect() {
    let html = "<header>\n  <form></form>\n  <details class=\"help-lang\"><summary>Idioma</summary>\
                <ul><li><a href=\"/zh/tc-help/\">中文</a></li></ul></details>\n  <a href=\"/es/\">site</a>\n\
                </header><script>window.__tcLocale={};</script>\n<script src=\"/assets/js/locale.js\"></script>\n\
                <script src=\"/assets/js/help-i18n.js\"></script>";
    assert_eq!(
        page("es/index.html", html),
        "<header>\n  <form></form>\n  \n  <a href=\"https://translationcore.com/es/\">site</a>\n\
         </header><script>window.__tcLocale={};</script>\n\n\
         <script src=\"../site/assets/js/help-i18n.js\"></script>"
    );
    // A part with no end is not cut: the rest of the page stays.
    let open = "<details class=\"help-lang\"><p>the page</p>";
    assert_eq!(page("index.html", open), open);
    // Only a page loses them.
    for (first, last) in HELP_CUT {
        let part = format!("{first}{last}").into_bytes();
        assert_eq!(help_overlay("assets/search.js", part.clone()), part);
    }
}

/// Every vendored page, in every language, holds the site's language menu and its redirect
/// script, and none is served with either (#1036). A re-vendored page whose menu or script tag
/// reads another way would show the menu, or ask for a script the app does not have.
#[test]
fn no_help_page_is_served_with_the_language_menu_or_the_language_redirect() {
    let languages = languages();
    assert_eq!(languages.len(), 9, "English and eight more: {languages:?}");
    let mut pages = 0;
    for language in &languages {
        let folder = help_dir().join(language);
        for entry in std::fs::read_dir(folder).unwrap() {
            let name = entry.unwrap().file_name().to_string_lossy().into_owned();
            if !name.ends_with(".html") {
                continue;
            }
            let page = format!("{language}{name}");
            let vendored = String::from_utf8(vendored(&page)).unwrap();
            for (first, last) in HELP_CUT {
                assert_eq!(vendored.matches(first).count(), 1, "{page}: {first}");
                assert!(vendored.contains(last), "{page}: {last}");
            }
            let served = served(&page);
            assert!(
                !served.contains("help-lang"),
                "{page} shows the language menu"
            );
            assert!(!served.contains("locale.js"), "{page} loads the redirect");
            assert!(
                !served.contains("data-locale="),
                "{page} links to another language"
            );
            // The messages the page's own scripts show stay.
            assert!(served.contains("window.TC4_HELP_I18N="), "{page}");
            pages += 1;
        }
    }
    assert!(pages > 800, "only {pages} pages read");
}

/// Only a page's and a style sheet's addresses are rewritten: a script is served as it is, and
/// so is a style sheet that names nothing from the site's root.
#[test]
fn a_help_file_that_is_not_a_page_is_served_as_it_is() {
    let html = b"<a href=\"/\">".to_vec();
    assert_eq!(help_overlay("assets/search.js", html.clone()), html);
    let bytes = vendored("assets/style.css");
    assert_eq!(help_overlay("assets/style.css", bytes.clone()), bytes);
    let not_text = vec![0xff, 0xfe, b'/'];
    assert_eq!(help_overlay("index.html", not_text.clone()), not_text);
}

/// A re-vendored page whose words moved would leave tC4's folder in place unnoticed.
#[test]
fn every_help_overlay_rule_finds_its_words_in_the_vendored_page() {
    for (rule, from, _) in HELP_OVERLAY {
        let pages = match rule {
            HelpPage::English(page) => vec![(*page).to_owned()],
            HelpPage::EveryLanguage(page) => languages()
                .iter()
                .map(|language| format!("{language}{page}"))
                .collect(),
        };
        for page in pages {
            assert!(rule.holds(&page), "{rule:?} does not hold {page}");
            let text = String::from_utf8(vendored(&page)).unwrap();
            assert!(text.contains(from), "{page} no longer holds {from:?}");
        }
    }
    assert!(!HelpPage::English("gs-install.html").holds("es/gs-install.html"));
    assert!(!HelpPage::EveryLanguage("gs-install.html").holds("es/sub/gs-install.html"));
}
