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

/// Where a help page describes tC4 4.0 and not this app (H16 parts 2 and 3): `(page, tC4's
/// words, this app's)`. The vendored pages stay the bytes `help-pages.txt` lists, so the
/// change is made as they are served. The download page is translationcore.com's `/desktop/`:
/// its old address `/tc4` redirects there (#1031).
pub const HELP_OVERLAY: &[(&str, &str, &str)] = &[
    (
        "st-where-projects-live.html",
        "pankosmia",
        "translationCore4",
    ),
    ("st-where-projects-live.html", "tc4-projects", "projects"),
    ("search-index.json", "pankosmia", "translationCore4"),
    ("search-index.json", "tc4-projects", "projects"),
    ("search-index.js", "pankosmia", "translationCore4"),
    ("search-index.js", "tc4-projects", "projects"),
    (
        "gs-install.html",
        "https://github.com/unfoldingWord/translationCore4/releases\">tC4 releases page",
        "https://translationcore.com/desktop/\">translationCore download page",
    ),
];

/// The site the help pages are published on, below [`HELP_SITE_FOLDER`]. A page's link that
/// starts with `/` names a page of this site.
pub const HELP_SITE: &str = "https://translationcore.com";

/// The help pages' folder on [`HELP_SITE`], which the app serves as `/help/`.
pub const HELP_SITE_FOLDER: &str = "/tc-help";

/// A help file as this app serves it: the vendored bytes with [`HELP_OVERLAY`] applied, and in
/// a page (`*.html`) each `href="/…"` made a link that works in the Help panel
/// ([`site_links`]).
pub fn help_overlay(path: &str, bytes: Vec<u8>) -> Vec<u8> {
    let rules: Vec<_> = HELP_OVERLAY
        .iter()
        .filter(|(page, _, _)| *page == path)
        .collect();
    let page = path.ends_with(".html");
    if rules.is_empty() && !page {
        return bytes;
    }
    // Help pages and their index are UTF-8 text; a file that is not is served as it is.
    let mut text = match String::from_utf8(bytes) {
        Ok(text) => text,
        Err(not_text) => return not_text.into_bytes(),
    };
    for (_, from, to) in rules {
        text = text.replace(from, to);
    }
    if page {
        text = site_links(path, &text);
    }
    text.into_bytes()
}

/// The page at `path` with each `href="/…"` rewritten (#1031). Served in the app, such a link
/// would load the app's own root, or a page the app does not have, inside the Help panel. A
/// link into the help folder becomes relative to the page, so it stays in the panel; any other
/// names translationcore.com, which the panel opens in the browser after the internet question.
fn site_links(path: &str, text: &str) -> String {
    const ATTRIBUTE: &str = "href=\"/";
    let up = "../".repeat(path.matches('/').count());
    let mut out = String::with_capacity(text.len() + 1024);
    let mut rest = text;
    while let Some(at) = rest.find(ATTRIBUTE) {
        // Up to and including `href="`; the value starts with its `/`.
        let (before, after) = rest.split_at(at + ATTRIBUTE.len() - 1);
        out.push_str(before);
        // `data-href="/"` and the like are not links.
        let space = at.checked_sub(1).and_then(|i| before.as_bytes().get(i));
        if !space.is_some_and(u8::is_ascii_whitespace) {
            rest = after;
            continue;
        }
        let end = after.find('"').unwrap_or(after.len());
        let (value, tail) = after.split_at(end);
        out.push_str(&site_link(&up, value));
        rest = tail;
    }
    out.push_str(rest);
    out
}

/// `value`, a link that starts with `/`, as a page `up` below the help folder must name it.
fn site_link(up: &str, value: &str) -> String {
    // `//host/…` already names another site.
    if value.starts_with("//") {
        return value.to_owned();
    }
    let in_help = value
        .strip_prefix(HELP_SITE_FOLDER)
        .filter(|rest| rest.is_empty() || rest.starts_with(['/', '#', '?']));
    match in_help {
        Some(rest) => {
            let page = rest.strip_prefix('/').unwrap_or(rest);
            // The folder itself is its index: `/help/` is not a page (`help_never_redirects`).
            let page = if page.is_empty() || page.starts_with(['#', '?']) {
                format!("index.html{page}")
            } else {
                page.to_owned()
            };
            format!("{up}{page}")
        }
        None => format!("{HELP_SITE}{value}"),
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
    match tokio::fs::metadata(file).await {
        Ok(meta) if meta.is_file() => {}
        _ => return StatusCode::NOT_FOUND.into_response(),
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
