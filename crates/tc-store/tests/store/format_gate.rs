//! The format gate at open (`docs/STORAGE.md` §12.2, O4) for a project a newer translationCore
//! wrote: the gate reads `major` and `minReaderMinor`, whatever else the newer version changed.

use crate::common::*;
use tc_store::{Mode, OpenOptions, ReadOnlyReason};

const FORMAT: &str = "ingredients/tc/format.json";

fn put_format(rig: &Rig, folder: &std::path::Path, bytes: &[u8]) {
    rig.fs.put(&folder.join(FORMAT), bytes, None);
}

/// INV-NEWER-MINOR-READ-ONLY: `minReaderMinor` above this app's minor opens read-only and
/// writes nothing.
#[test]
fn a_newer_minor_this_app_cannot_write_opens_read_only_and_writes_nothing() {
    let (rig, folder) = titus();
    let newer =
        std::fs::read(repo_root().join("fixtures/journal/format-1.4-read-only.json")).unwrap();
    put_format(&rig, &folder, &newer);
    let before = files(&rig.fs, &folder);
    let handle = rig.store.open(&folder, &OpenOptions::default()).unwrap();
    assert_eq!(
        handle.facts().mode,
        Mode::ReadOnly(ReadOnlyReason::NewerMinor {
            min_reader_minor: "4".into()
        })
    );
    handle.close().unwrap();
    assert_eq!(
        files(&rig.fs, &folder),
        before,
        "a read-only open writes nothing"
    );
}

/// INV-FORMAT-HEADER-FROZEN: a newer major is refused by its `major` alone, even when a field
/// this app reads has a shape it cannot parse.
#[test]
fn a_newer_major_with_fields_this_app_cannot_parse_is_refused_before_write() {
    let (rig, folder) = titus();
    put_format(
        &rig,
        &folder,
        br#"{"format":"tc-project","major":2,"minor":0,"minReaderMinor":0,"derivations":"moved","derivedPaths":{}}"#,
    );
    let before = files(&rig.fs, &folder);
    match rig.store.open(&folder, &OpenOptions::default()) {
        Err(tc_store::OpenError::NewerMajor { major }) => assert_eq!(major, "2"),
        Err(other) => panic!("{other}"),
        Ok(handle) => {
            let mode = handle.facts().mode.clone();
            handle.close().unwrap();
            let after = files(&rig.fs, &folder);
            panic!(
                "a project of format 2 opened ({mode:?}); format.json {}",
                if after.get(FORMAT) == before.get(FORMAT) {
                    "kept"
                } else {
                    "rewritten"
                }
            )
        }
    }
    assert_eq!(files(&rig.fs, &folder), before, "nothing written");
}

/// INV-FORMAT-HEADER-FROZEN: a newer minor whose `minReaderMinor` is above this app's opens
/// read-only, even when a field this app reads has a value it cannot parse.
#[test]
fn a_newer_minor_with_a_field_this_app_cannot_parse_still_opens_read_only() {
    let (rig, folder) = titus();
    put_format(
        &rig,
        &folder,
        br#"{"format":"tc-project","major":1,"minor":5,"minReaderMinor":5,"derivations":{"plainText":"2.1"},"derivedPaths":[]}"#,
    );
    let before = files(&rig.fs, &folder);
    let handle = rig.store.open(&folder, &OpenOptions::default()).unwrap();
    let mode = handle.facts().mode.clone();
    handle.close().unwrap();
    let after = files(&rig.fs, &folder);
    assert_eq!(
        mode,
        Mode::ReadOnly(ReadOnlyReason::NewerMinor {
            min_reader_minor: "5".into()
        }),
        "format.json {}",
        if after.get(FORMAT) == before.get(FORMAT) {
            "kept"
        } else {
            "rewritten"
        }
    );
    assert_eq!(after, before, "a read-only open writes nothing");
}
