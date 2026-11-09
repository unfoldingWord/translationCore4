//! The repository's `LICENSE`, the file About and its License dialog show
//! (`views/account_menu.rs`), is the MIT text plus one line that begins with "Copyright": the
//! copyright notice and the translationCore® trademark statement. GitHub's license detector
//! (licensee) drops the lines that begin with "Copyright" and then needs the rest to match a
//! license text word for word; a statement on any other line makes the repository read "Other"
//! instead of MIT (#965). This test is that rule, so the file cannot drift back.
#![cfg(not(target_arch = "wasm32"))]
#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    reason = "test code: a failed unwrap is a failed test"
)]

use std::path::Path;

/// The MIT text as GitHub publishes it (`gh api /licenses/mit`), less its copyright line.
const MIT: &str = r#"MIT License

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
"#;

fn license() -> String {
    let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../LICENSE");
    std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("{} is readable: {e}", path.display()))
}

/// The lines that carry words, in order.
fn lines(text: &str) -> Vec<&str> {
    text.lines()
        .map(str::trim_end)
        .filter(|line| !line.is_empty())
        .collect()
}

#[test]
fn license_is_mit_apart_from_its_copyright_line() {
    let text = license();
    let (copyright, rest): (Vec<&str>, Vec<&str>) = lines(&text)
        .into_iter()
        .partition(|line| line.starts_with("Copyright"));
    assert_eq!(
        rest,
        lines(MIT),
        "every line but the Copyright one is GitHub's MIT text"
    );
    assert_eq!(
        copyright.len(),
        1,
        "one Copyright line, the one About shows: {copyright:?}"
    );
}

#[test]
fn the_copyright_line_states_the_trademark() {
    let text = license();
    let line = text
        .lines()
        .find(|line| line.starts_with("Copyright"))
        .expect("a Copyright line");
    assert!(
        line.starts_with("Copyright (c) 2017-2026 unfoldingWord"),
        "{line}"
    );
    assert!(
        line.contains("translationCore® is a registered trademark of unfoldingWord"),
        "the trademark statement stays on the copyright line, where the detector ignores it: {line}"
    );
}
