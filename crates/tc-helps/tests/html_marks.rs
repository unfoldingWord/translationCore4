//! tC4 #910: the HTML marks the bundled articles hold (`<br>`, `<sup>`, `<u>`) are drawn as
//! the author meant them, never shown as text. Every article of the en_ta and en_tw the app
//! ships goes through the renderer the article pane and the note cards use.
#![allow(
    clippy::unwrap_used,
    clippy::panic,
    reason = "test code: a failed unwrap is a failed test"
)]

use std::io::Read;
use std::path::PathBuf;

use tc_helps::blocks::render_article_blocks;

/// Every article of a burrito in `bundle/en`, by its path in the zip.
fn articles(zip: &str) -> Vec<(String, String)> {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../bundle/en")
        .join(zip);
    let mut archive = zip::ZipArchive::new(std::fs::File::open(&path).unwrap()).unwrap();
    let names: Vec<String> = archive
        .file_names()
        .filter(|n| n.ends_with(".md"))
        .map(str::to_owned)
        .collect();
    names
        .into_iter()
        .map(|name| {
            let mut text = String::new();
            archive
                .by_name(&name)
                .unwrap()
                .read_to_string(&mut text)
                .unwrap();
            (name, text)
        })
        .collect()
}

#[test]
fn no_bundled_article_shows_an_html_mark_as_text() {
    for zip in ["en_ta_v91.sb.zip", "en_tw_v91.sb.zip"] {
        let all = articles(zip);
        let with_marks = all
            .iter()
            .filter(|(_, md)| ["<br", "<sup", "<u>"].iter().any(|m| md.contains(m)))
            .count();
        assert!(
            zip != "en_ta_v91.sb.zip" || with_marks >= 28,
            "{zip}: the scan reads the articles that hold the marks ({with_marks})"
        );
        for (name, md) in &all {
            for block in render_article_blocks(md) {
                let mut texts = vec![block.text()];
                texts.extend(
                    block
                        .cells
                        .iter()
                        .map(|c| c.iter().map(|s| s.text.as_str()).collect()),
                );
                for text in texts {
                    for mark in ["<br", "<sup", "</sup>", "<u>", "</u>"] {
                        assert!(!text.contains(mark), "{name}: {mark} as text in {text:?}");
                    }
                }
            }
        }
    }
}
