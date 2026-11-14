//! Every link, image, style sheet, script, form and search result of every vendored help page
//! resolves in the app, as `tc4 serve` serves the pages (#1031). A re-vendored page that links
//! somewhere the app has no file for, to the app's own root, or to a translationcore.com
//! address nobody checked fails here.
#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    reason = "test code: a failed unwrap is a failed test"
)]

mod common;

use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};

use common::{TestServer, stub};
use regex::Regex;
use tc_server::HELP_SITE;

/// The translationcore.com addresses the help pages may name. Each answered 200 with no
/// redirect when it was added (`curl -sI`, 2026-11-13); a page naming another one fails, so a
/// person checks it before it ships.
const CHECKED_SITE_PAGES: &[&str] = &["/", "/desktop/"];

/// tc-ui's folder, which holds `help/` as `build-app.sh` copies it. Without `..` in it: the
/// server refuses any file whose path has one.
fn ui_dir() -> PathBuf {
    std::fs::canonicalize(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../tc-ui")).unwrap()
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

/// What a target must be: any file, or a page (a form's answer, a search result).
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Debug)]
enum Want {
    File,
    Page,
}

/// Where a target leads, as the Help panel sees it.
#[derive(Debug, PartialEq, Eq)]
enum Target {
    /// Nowhere new: a place on the same page, or inline data.
    Stays,
    /// A file below `/help/`, to fetch.
    Help(String),
    /// Another site: a link opens it in the browser; anything else would load it.
    Away,
}

/// `target` as named in the file at `from`, below `/help/`, or why the app cannot follow it.
fn resolve(from: &str, target: &str) -> Result<Target, String> {
    let target = target.trim();
    if target.is_empty() || target.starts_with('#') {
        return Ok(Target::Stays);
    }
    if target.starts_with("//") {
        return Err("names another site without its scheme".to_owned());
    }
    if target.starts_with('/') {
        return Err("starts with `/`: in the app it names the app's own root".to_owned());
    }
    if let Some((scheme, _)) = target.split_once(':')
        && scheme
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || "+-.".contains(c))
    {
        return match scheme.to_ascii_lowercase().as_str() {
            "https" | "http" => site_page(target).map(|()| Target::Away),
            "mailto" => Ok(Target::Away),
            "data" => Ok(Target::Stays),
            other => Err(format!("a `{other}:` link")),
        };
    }
    let path = target.split(['#', '?']).next().unwrap_or_default();
    if path.is_empty() {
        return Ok(Target::Stays);
    }
    let mut parts: Vec<&str> = from.split('/').collect();
    parts.pop();
    for segment in path.split('/') {
        match segment {
            "" | "." => {}
            ".." => {
                if parts.pop().is_none() {
                    return Err("leaves the help folder".to_owned());
                }
            }
            name => parts.push(name),
        }
    }
    Ok(Target::Help(parts.join("/")))
}

/// An address on translationcore.com, or on any of its hosts, must be `https://` on the bare
/// host and a page [`CHECKED_SITE_PAGES`] lists: any other form may redirect.
fn site_page(url: &str) -> Result<(), String> {
    let (scheme, rest) = url.split_once("://").unwrap_or(("", url));
    let host_end = rest.find(['/', '?', '#']).unwrap_or(rest.len());
    let (host, path) = rest.split_at(host_end);
    let host = host.to_ascii_lowercase();
    let site = HELP_SITE.trim_start_matches("https://");
    if host != site && !host.ends_with(&format!(".{site}")) {
        return Ok(());
    }
    let path = path.split(['#', '?']).next().unwrap_or_default();
    let path = if path.is_empty() { "/" } else { path };
    if scheme.eq_ignore_ascii_case("https") && host == site && CHECKED_SITE_PAGES.contains(&path) {
        Ok(())
    } else {
        Err(format!(
            "names {url}, which is not {HELP_SITE} with a page CHECKED_SITE_PAGES lists"
        ))
    }
}

/// The URLs a `srcset` names: each candidate's first word.
fn srcset_urls(value: &str) -> impl Iterator<Item = &str> {
    value
        .split(',')
        .filter_map(|candidate| candidate.split_whitespace().next())
}

#[test]
fn every_help_link_image_and_style_sheet_resolves_in_the_app() {
    let server = TestServer::start_with(stub(), |config| config.ui_dir = ui_dir(), true);
    let help = ui_dir().join("help");
    let mut files = BTreeSet::new();
    files_under(&help, &help, &mut files);

    let tag = Regex::new(r"(?is)<([a-z][a-z0-9-]*)\b([^>]*)>").unwrap();
    let attribute = Regex::new(
        r#"(?is)\s(href|src|srcset|action|poster|data)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))"#,
    )
    .unwrap();
    let css_url = Regex::new(r#"(?i)url\(\s*["']?([^"')]+)["']?\s*\)"#).unwrap();

    // target path -> (what it must be, where it was named)
    let mut targets: BTreeMap<String, (Want, String)> = BTreeMap::new();
    let mut problems = Vec::new();
    let mut named = 0;
    // `link`: the element is one a person clicks (`a`, `area`), which may go to another site;
    // anything else there would load it with the internet off.
    let mut want = |from: &str, value: &str, kind: Want, link: bool, problems: &mut Vec<String>| {
        named += 1;
        match resolve(from, value) {
            Ok(Target::Help(path)) => {
                let entry = targets
                    .entry(path)
                    .or_insert((kind, format!("{from} → {value}")));
                entry.0 = entry.0.max(kind);
            }
            Ok(Target::Away) if !link => problems.push(format!(
                "help/{from}: {value:?} loads something from another site"
            )),
            Ok(Target::Stays | Target::Away) => {}
            Err(why) => problems.push(format!("help/{from}: {value:?} {why}")),
        }
    };

    let mut pages = 0;
    for file in &files {
        let is_page = file.ends_with(".html");
        if !is_page && !file.ends_with(".css") {
            continue;
        }
        let served = server.get(&format!("/help/{file}"));
        assert_eq!(served.status, 200, "GET /help/{file}");
        let text = served.text();
        if is_page {
            pages += 1;
            for element in tag.captures_iter(&text) {
                let name = element[1].to_ascii_lowercase();
                let link = matches!(name.as_str(), "a" | "area");
                // A link may open a screenshot full size; a form's answer is a page.
                let kind = if name == "form" {
                    Want::Page
                } else {
                    Want::File
                };
                for found in attribute.captures_iter(&element[2]) {
                    let value = (2..=4).find_map(|i| found.get(i)).unwrap().as_str();
                    if found[1].eq_ignore_ascii_case("srcset") {
                        for url in srcset_urls(value) {
                            want(file, url, Want::File, false, &mut problems);
                        }
                    } else {
                        want(file, value, kind, link, &mut problems);
                    }
                }
            }
        }
        // A style sheet, a <style> block or a style attribute.
        for found in css_url.captures_iter(&text) {
            want(file, &found[1], Want::File, false, &mut problems);
        }
    }

    // The search box and the search page build their result links from the index the page
    // loads, `search-index.js`, as the script runs; no page holds them.
    let script = server.get("/help/search-index.js").text();
    let json = script
        .find('{')
        .zip(script.rfind('}'))
        .map(|(start, end)| &script[start..=end])
        .expect("search-index.js holds the index as JSON");
    let index: serde_json::Value = serde_json::from_str(json).unwrap();
    let docs = index["docs"].as_array().expect("search-index.js has docs");
    for doc in docs {
        let url = doc["url"].as_str().expect("each search result has a url");
        want("search.html", url, Want::Page, true, &mut problems);
    }

    for (path, (kind, from)) in &targets {
        let answer = server.get(&format!("/help/{path}"));
        if answer.status != 200 {
            problems.push(format!(
                "{from}: GET /help/{path} answered {}",
                answer.status
            ));
            continue;
        }
        let html = answer
            .header("content-type")
            .is_some_and(|t| t.starts_with("text/html"));
        if *kind == Want::Page && !html {
            problems.push(format!("{from}: /help/{path} is not a page"));
        }
    }

    assert!(problems.is_empty(), "{}", problems.join("\n"));
    assert!(pages > 50, "only {pages} pages walked");
    assert!(docs.len() > 50, "only {} search results walked", docs.len());
    assert!(
        targets.len() > 100,
        "only {} targets checked",
        targets.len()
    );
    assert!(named > 5_000, "only {named} links read");
}

/// The walk itself: a link it should refuse is refused, and one it should follow is followed.
#[test]
fn the_help_link_walk_refuses_what_the_app_cannot_serve() {
    let help = |path: &str| Ok(Target::Help(path.to_owned()));
    assert_eq!(resolve("a.html", "b"), help("b"));
    assert_eq!(resolve("a.html", "img/x.png?v=1#y"), help("img/x.png"));
    assert_eq!(resolve("sub/a.html", "../b"), help("b"));
    assert_eq!(resolve("a.html", "#main"), Ok(Target::Stays));
    assert_eq!(resolve("a.html", "https://example.org/x"), Ok(Target::Away));
    assert_eq!(
        resolve("a.html", &format!("{HELP_SITE}/desktop/#mac")),
        Ok(Target::Away)
    );
    assert_eq!(resolve("a.html", HELP_SITE), Ok(Target::Away));
    for bad in [
        "/",
        "/tc-help/",
        "//example.org/x",
        "../x",
        "javascript:alert(1)",
        "https://translationcore.com/tc4",
        "http://translationcore.com/",
        "https://www.translationcore.com/desktop/",
        "HTTPS://TRANSLATIONCORE.COM/pricing",
    ] {
        assert!(resolve("a.html", bad).is_err(), "{bad} was not refused");
    }
    assert_eq!(
        srcset_urls("img/a.png 1x, img/b.png 2x,img/c.png").collect::<Vec<_>>(),
        ["img/a.png", "img/b.png", "img/c.png"]
    );
}
