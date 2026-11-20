//! The UI's files (APP-DESIGN §5.3), read from the folder `--ui` names.
//!
//! For the unit that writes `index.html` (A4a): every origin is new at each launch, because
//! the port is, so `immutable` helps only within one launch; everything under `/ui/` must
//! still carry a content hash in its name; and `index.html` cannot hold an inline script,
//! because its CSP allows none.

use std::path::{Component, Path as FsPath, PathBuf};
use std::sync::Arc;

use crate::backend::{Backend, MediaFile};
use crate::state::AppState;
use axum::extract::{Path, State};
use axum::http::{HeaderValue, StatusCode, header};
use axum::response::{IntoResponse, Response};

use crate::state::Shared;

/// The Content-Security-Policy of §5.2 for `index.html`.
pub const CSP: &str = "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' \
                       'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; frame-src \
                       'self'; object-src 'none'; base-uri 'none'";

const IMMUTABLE: &str = "public, max-age=31536000, immutable";

pub(crate) async fn index(State(shared): State<Arc<Shared>>) -> Response {
    let mut response = serve(&shared.ui_dir.join("index.html"), "no-store").await;
    if response.status() == StatusCode::OK {
        response.headers_mut().insert(
            header::CONTENT_SECURITY_POLICY,
            HeaderValue::from_static(CSP),
        );
    }
    response
}

pub(crate) async fn prepare(State(shared): State<Arc<Shared>>) -> Response {
    serve(&shared.ui_dir.join("prepare.html"), "no-store").await
}

pub(crate) async fn ui(State(shared): State<Arc<Shared>>, Path(path): Path<String>) -> Response {
    match under(&shared.ui_dir.join("ui"), &path) {
        Some(file) => serve(&file, IMMUTABLE).await,
        None => StatusCode::NOT_FOUND.into_response(),
    }
}

/// Help pages never redirect: tower-http's `ServeDir` answers a directory with one, which
/// would send the help window to a URL the page-swap shim does not know (DELTA §3.15.8).
///
/// The pages link to each other without `.html` (`gs-install`), as translationcore.com serves
/// them, while the vendored files keep their names (#1031). A path with no file of its own is
/// answered with the file that adds `.html`, at the address the page asked for.
pub(crate) async fn help(State(shared): State<Arc<Shared>>, Path(path): Path<String>) -> Response {
    let Some(file) = under(&shared.ui_dir.join("help"), &path) else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let (file, page) = if is_file(&file).await {
        (file, path)
    } else {
        let mut with_html = file.into_os_string();
        with_html.push(".html");
        (PathBuf::from(with_html), format!("{path}.html"))
    };
    serve_as(&file, "no-cache", |bytes| help_overlay(&page, bytes)).await
}

async fn is_file(file: &FsPath) -> bool {
    tokio::fs::metadata(file)
        .await
        .is_ok_and(|meta| meta.is_file())
}

/// The one file `--notices` names (#606): no path from the request reaches the disk.
pub(crate) async fn notices(State(shared): State<Arc<Shared>>) -> Response {
    match &shared.notices {
        Some(file) => serve(file, "no-cache").await,
        None => StatusCode::NOT_FOUND.into_response(),
    }
}

/// The files a [`HELP_OVERLAY`] rule changes (#1036).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HelpPage {
    /// The English file at this path below the help folder: the rule's words are English.
    English(&'static str),
    /// The file of this name in English and in every other language's folder.
    EveryLanguage(&'static str),
}

impl HelpPage {
    /// Whether the rule changes the file at `path`, below the help folder.
    pub fn holds(self, path: &str) -> bool {
        match self {
            HelpPage::English(page) => path == page,
            HelpPage::EveryLanguage(page) => {
                path == page || path.split_once('/').is_some_and(|(_, name)| name == page)
            }
        }
    }
}

/// Where a help page describes tC4 4.0 and not this app (H16 parts 2 and 3): `(page, tC4's
/// words, this app's)`. The vendored pages stay the bytes `help-pages.txt` lists, so the
/// change is made as they are served. The download page is translationcore.com's `/desktop/`:
/// its old address `/tc4` redirects there (#1031). A folder's name and an address read the
/// same in every language; a link's words do not, and only the English ones have a rule.
pub const HELP_OVERLAY: &[(HelpPage, &str, &str)] = &[
    (
        HelpPage::EveryLanguage("st-where-projects-live.html"),
        "pankosmia",
        "translationCore4",
    ),
    (
        HelpPage::EveryLanguage("st-where-projects-live.html"),
        "tc4-projects",
        "projects",
    ),
    (
        HelpPage::English("search-index.json"),
        "pankosmia",
        "translationCore4",
    ),
    (
        HelpPage::English("search-index.json"),
        "tc4-projects",
        "projects",
    ),
    (
        HelpPage::EveryLanguage("search-index.js"),
        "pankosmia",
        "translationCore4",
    ),
    (
        HelpPage::EveryLanguage("search-index.js"),
        "tc4-projects",
        "projects",
    ),
    (
        HelpPage::EveryLanguage("gs-install.html"),
        "https://github.com/unfoldingWord/translationCore4/releases\"",
        "https://translationcore.com/desktop/\"",
    ),
    (
        HelpPage::English("gs-install.html"),
        ">tC4 releases page<",
        ">translationCore download page<",
    ),
];

/// What a page of the site holds that Help in the app must not (#1036): `(its first words, its
/// last)`. A page is served without each such part. Help follows the app's language, so the
/// site's language menu goes; so does the script that sends a reader to the computer's
/// language, at an address the app does not serve (`vendor-help.sh` does not copy it).
pub const HELP_CUT: &[(&str, &str)] = &[
    ("<details class=\"help-lang\">", "</details>"),
    ("<script src=\"/assets/js/locale.js\">", "</script>"),
];

/// The site the help pages are published on. An address in a page that starts with `/` names
/// a file of this site.
pub const HELP_SITE: &str = "https://translationcore.com";

/// The English help pages' folder on [`HELP_SITE`], which the app serves as `/help/`. Another
/// language's is `/{lang}/tc-help` there and `/help/{lang}/` here.
pub const HELP_SITE_FOLDER: &str = "/tc-help";

/// The folder of [`HELP_SITE`] that holds the site's own style sheets, scripts and fonts. The
/// app serves the ones a help page loads, below `/help/site/assets/`.
const HELP_SITE_ASSETS: &str = "/assets";

/// A help file as this app serves it: the vendored bytes with [`HELP_OVERLAY`] applied; a page
/// (`*.html`) without its [`HELP_CUT`] parts; and each address that starts with `/`, in a
/// page's `href` or `src` or in a style sheet's `url()`, made one that works in the Help panel
/// ([`site_link`]).
pub fn help_overlay(path: &str, bytes: Vec<u8>) -> Vec<u8> {
    let rules: Vec<_> = HELP_OVERLAY
        .iter()
        .filter(|(page, _, _)| page.holds(path))
        .collect();
    let page = path.ends_with(".html");
    let style_sheet = path.ends_with(".css");
    if rules.is_empty() && !page && !style_sheet {
        return bytes;
    }
    // Help pages, their style sheets and their index are UTF-8 text; a file that is not is
    // served as it is.
    let mut text = match String::from_utf8(bytes) {
        Ok(text) => text,
        Err(not_text) => return not_text.into_bytes(),
    };
    for (_, from, to) in rules {
        text = text.replace(from, to);
    }
    let up = "../".repeat(path.matches('/').count());
    if page {
        for (first, last) in HELP_CUT {
            text = without(&text, first, last);
        }
        text = site_links(&text, "=\"/", '"', is_link_attribute, &up);
    } else if style_sheet {
        text = site_links(&text, "url(/", ')', |_| true, &up);
    }
    text.into_bytes()
}

/// `text` without each part that runs from `first` to the next `last`. A part with no end
/// stays, so the page is served whole; `tests/help_overlay.rs` fails for such a page.
fn without(text: &str, first: &str, last: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(at) = rest.find(first) {
        let Some(len) = rest[at..].find(last) else {
            break;
        };
        out.push_str(&rest[..at]);
        rest = &rest[at + len + last.len()..];
    }
    out.push_str(rest);
    out
}

/// Whether the text before `="/…"` ends with the name of an attribute that a page loads or
/// follows. `data-href="/"` and the like are not links: the name follows a space.
fn is_link_attribute(before: &str) -> bool {
    ["href", "src"].iter().any(|name| {
        before
            .strip_suffix(name)
            .is_some_and(|tag| tag.ends_with(|c: char| c.is_ascii_whitespace()))
    })
}

/// `text` with each address that starts with `/` rewritten (#1031, #1036): served in the app,
/// such an address would name the app's own root, or a file the app does not have. `opens`
/// ends with the address's `/`, the address runs to `closes`, and `is_address` reads what
/// stands before `opens`. [`site_link`] gives the address a file `up` below the help folder
/// can use.
fn site_links(
    text: &str,
    opens: &str,
    closes: char,
    is_address: impl Fn(&str) -> bool,
    up: &str,
) -> String {
    let mut out = String::with_capacity(text.len() + 1024);
    let mut rest = text;
    while let Some(at) = rest.find(opens) {
        // The last `/` of `opens` is the address's first character, so it stays with it.
        let (before, after) = rest.split_at(at + opens.len() - 1);
        out.push_str(before);
        if !is_address(&rest[..at]) {
            rest = after;
            continue;
        }
        let end = after.find(closes).unwrap_or(after.len());
        let (value, tail) = after.split_at(end);
        out.push_str(&site_link(up, value));
        rest = tail;
    }
    out.push_str(rest);
    out
}

/// `value`, an address that starts with `/`, as a file `up` below the help folder must name
/// it. A file the app serves below `/help/` becomes relative to that file, so a link to it
/// stays in the panel; any other address names translationcore.com, which the panel opens in
/// the browser after the internet question.
fn site_link(up: &str, value: &str) -> String {
    // `//host/…` already names another site.
    if value.starts_with("//") {
        return value.to_owned();
    }
    let end = value.find(['#', '?']).unwrap_or(value.len());
    let (path, rest) = value.split_at(end);
    match help_file(path) {
        Some(file) => format!("{up}{file}{rest}"),
        None => format!("{HELP_SITE}{value}"),
    }
}

/// The file below `/help/` that holds the site's `path`, or `None` for a path the app does not
/// serve. The English help (`/tc-help/…`) is the help folder itself, another language's
/// (`/{lang}/tc-help/…`) is that language's folder in it, and the site's own files
/// (`/assets/…`) are below `site/`. `vendor-help.sh` places the files so, and
/// `tests/help_links.rs` proves that every address a vendored page names has its file.
fn help_file(path: &str) -> Option<String> {
    // The folder itself is its index: `/help/` is not a page (`help_never_redirects`).
    fn page(name: &str) -> &str {
        if name.is_empty() { "index.html" } else { name }
    }
    if let Some(name) = below(path, HELP_SITE_FOLDER) {
        return Some(page(name).to_owned());
    }
    if let Some(file) = below(path, HELP_SITE_ASSETS) {
        return (!file.is_empty()).then(|| format!("site{HELP_SITE_ASSETS}/{file}"));
    }
    let (lang, _) = path.strip_prefix('/')?.split_once('/')?;
    let name = below(&path[1 + lang.len()..], HELP_SITE_FOLDER)?;
    (!lang.is_empty()).then(|| format!("{lang}/{}", page(name)))
}

/// What `path` names below `folder`: nothing for the folder itself, and `None` for a path
/// outside it (`/tc-helpers` is not in `/tc-help`).
fn below<'a>(path: &'a str, folder: &str) -> Option<&'a str> {
    let rest = path.strip_prefix(folder)?;
    if rest.is_empty() {
        Some(rest)
    } else {
        rest.strip_prefix('/')
    }
}

/// `path` below `root`, or `None` for a path that could leave it. An empty segment, `.`,
/// `..`, a backslash, a colon (a drive or a stream name on Windows) or a NUL refuses the
/// whole path.
fn under(root: &FsPath, path: &str) -> Option<PathBuf> {
    let mut file = root.to_path_buf();
    for segment in path.split('/') {
        let refused = segment.is_empty()
            || segment == "."
            || segment == ".."
            || segment.contains(['\\', ':', '\0']);
        if refused {
            return None;
        }
        file.push(segment);
    }
    // Belt and braces: whatever the segments said, only plain names were pushed.
    file.components()
        .all(|part| !matches!(part, Component::ParentDir))
        .then_some(file)
}

async fn serve(file: &FsPath, cache_control: &'static str) -> Response {
    serve_as(file, cache_control, |bytes| bytes).await
}

async fn serve_as(
    file: &FsPath,
    cache_control: &'static str,
    change: impl FnOnce(Vec<u8>) -> Vec<u8>,
) -> Response {
    // Only a regular file: a directory is a 404, never a redirect or a listing.
    if !is_file(file).await {
        return StatusCode::NOT_FOUND.into_response();
    }
    let Ok(bytes) = tokio::fs::read(file).await else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let mut response = change(bytes).into_response();
    let headers = response.headers_mut();
    headers.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static(content_type(file)),
    );
    headers.insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static(cache_control),
    );
    response
}

fn content_type(file: &FsPath) -> &'static str {
    let extension = file
        .extension()
        .and_then(|extension| extension.to_str())
        .map(str::to_ascii_lowercase);
    match extension.as_deref() {
        Some("html") => "text/html; charset=utf-8",
        Some("js" | "mjs") => "text/javascript; charset=utf-8",
        Some("css") => "text/css; charset=utf-8",
        // `instantiateStreaming` refuses any other type.
        Some("wasm") => "application/wasm",
        Some("json") => "application/json",
        Some("woff2") => "font/woff2",
        Some("woff") => "font/woff",
        Some("ttf") => "font/ttf",
        Some("otf") => "font/otf",
        Some("png") => "image/png",
        Some("jpg" | "jpeg") => "image/jpeg",
        Some("gif") => "image/gif",
        Some("svg") => "image/svg+xml",
        Some("ico") => "image/x-icon",
        Some("txt") => "text/plain; charset=utf-8",
        _ => "application/octet-stream",
    }
}

/// `GET /media/obs/{pack}/{path}`: a picture of an installed pack (§5.3). The backend decides
/// what it serves; the answer is cached by the page for the launch, since a pack's id names
/// its commit.
pub(crate) async fn obs_picture<B: Backend>(
    State(state): State<AppState<B>>,
    Path((pack, path)): Path<(String, String)>,
) -> Response {
    served(
        state.backend.obs_picture(&pack, &path).await,
        "private, max-age=3600",
    )
}

/// `GET /print/{job}`: the print document of a finished print export (§5.5). It is made for
/// one print, so nothing keeps it.
pub(crate) async fn print_page<B: Backend>(
    State(state): State<AppState<B>>,
    Path(job): Path<String>,
) -> Response {
    served(state.backend.print_page(&job).await, "no-store")
}

fn served(file: Option<MediaFile>, cache: &'static str) -> Response {
    let Some(file) = file else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let mut response = file.bytes.into_response();
    let headers = response.headers_mut();
    headers.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static(file.content_type),
    );
    headers.insert(header::CACHE_CONTROL, HeaderValue::from_static(cache));
    response
}
