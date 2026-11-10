//! tC4's print markup with the rebuild's declared differences, shared by tc-export's and
//! tc-ui's tests (`#[path]`), so the preview and the PDF accept the same markup.

use tc_core::VerseSpan;

/// tC4's print markup with the rebuild's declared difference (`docs/DIFFERENCES.md`, #992):
/// the verse right after a drop cap shows no number when it is verse 1 or a span from 1.
pub fn tc4_with_differences(tc4: &str) -> String {
    const DROP_CAP: &str = "<span class=\"print-dropcap\">";
    const NUMBER: &str = "<sup class=\"print-verse-number\">";
    let mut out = String::with_capacity(tc4.len());
    let mut rest = tc4;
    while let Some(at) = rest.find(DROP_CAP) {
        // The drop cap's span, then the opening tag of the verse after it.
        let drop_cap_end = at + rest[at..].find("</span>").unwrap() + "</span>".len();
        let verse_open_end = drop_cap_end + rest[drop_cap_end..].find('>').unwrap() + 1;
        out.push_str(&rest[..verse_open_end]);
        rest = &rest[verse_open_end..];
        if let Some(number) = rest.strip_prefix(NUMBER) {
            let end = number.find("</sup>").unwrap();
            if number[..end]
                .parse::<VerseSpan>()
                .is_ok_and(|span| span.start() == 1)
            {
                rest = &number[end + "</sup>".len()..];
            }
        }
    }
    out.push_str(rest);
    out
}
