//! The capsules of every frozen format version (`docs/STORAGE.md` §12.3, PLAN P10, #865):
//! nobody changes them, the current build opens each one with all its work unchanged, each
//! can be edited, saved and exchanged, and a newer minor's changes among them are kept.

#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    reason = "test code: a failed unwrap is a failed test"
)]

#[path = "../examples/capsule/support.rs"]
mod support;

use std::path::{Path, PathBuf};
use support::*;
use tc_journal::command::Command;
use tc_journal::fold::{Notice, ProjectKind};
use tc_journal::{FrameNo, Record, RecordKey, StoryNo};
use tc_store::{CheckpointReason, ProjectHandle};
use tc_sync::exchange::{export, receive};

/// Every frozen version's folder under `fixtures/capsules/`, oldest first.
fn versions() -> Vec<(String, PathBuf)> {
    let root = repo_root().join("fixtures/capsules");
    let mut out: Vec<(String, PathBuf)> = std::fs::read_dir(&root)
        .unwrap_or_else(|e| panic!("{}: {e}", root.display()))
        .map(|entry| entry.unwrap())
        .filter(|entry| entry.file_type().unwrap().is_dir())
        .map(|entry| {
            (
                entry.file_name().to_string_lossy().into_owned(),
                entry.path(),
            )
        })
        .collect();
    out.sort();
    assert!(!out.is_empty(), "no capsule set under {}", root.display());
    out
}

/// Every capsule of every version: (version, name, folder).
fn capsules() -> Vec<(String, &'static str, PathBuf)> {
    versions()
        .into_iter()
        .flat_map(|(version, dir)| {
            CAPSULES
                .into_iter()
                .map(move |name| (version.clone(), name, dir.join(name)))
        })
        .collect()
}

fn expect_of(capsule: &Path) -> serde_json::Value {
    serde_json::from_slice(&std::fs::read(capsule.join(EXPECT)).unwrap()).unwrap()
}

/// A fresh store with a copy of the capsule's project in its projects folder.
fn opened(work: &Path, who: &str, capsule: &Path, name: &str) -> (Computer, PathBuf) {
    let computer = Computer::new(work, who);
    let folder = computer.projects.join(name);
    copy_tree(&capsule.join(PROJECT), &folder, &|_| true);
    (computer, folder)
}

fn no_damage(handle: &ProjectHandle, what: &str) {
    let damaged: Vec<String> = handle
        .notices()
        .into_iter()
        .filter(|n| matches!(n.notice, Notice::StorageDamage { .. }))
        .map(|n| format!("{:?}", n.notice))
        .collect();
    assert!(
        damaged.is_empty(),
        "INV-OLD-PROJECTS-OPEN-UNCHANGED: {what} is called damaged: {damaged:#?}"
    );
}

/// INV-CAPSULES-ARE-IMMUTABLE: every capsule of every frozen version is there and its files
/// equal its lock, byte for byte, with none added or removed.
#[test]
fn capsules_match_their_lock() {
    for (version, name, capsule) in capsules() {
        assert!(
            capsule.join(PROJECT).join("metadata.json").is_file(),
            "INV-CAPSULES-ARE-IMMUTABLE: capsule {version}/{name} has no project"
        );
        let lock = std::fs::read_to_string(capsule.join(LOCK)).unwrap_or_else(|e| {
            panic!("INV-CAPSULES-ARE-IMMUTABLE: capsule {version}/{name} has no lock: {e}")
        });
        assert!(
            lock_of(&capsule) == lock,
            "INV-CAPSULES-ARE-IMMUTABLE: capsule {version}/{name} differs from its LOCK.sha256; a frozen capsule is never changed: find the bug, or freeze a new version (§12.3)"
        );
    }
}

/// INV-OLD-PROJECTS-OPEN-UNCHANGED: opened by the current build, every capsule is a valid
/// Scripture Burrito, opens writable, is never called damaged, and projects exactly what
/// the frozen build recorded in `EXPECT.json`: every record, head, history entry, conflict
/// and carried placement.
#[test]
fn every_capsule_opens_unchanged_and_validates() {
    let work = tempfile::tempdir().unwrap();
    for (version, name, capsule) in capsules() {
        let what = format!("capsule {version}/{name}");
        let problems = tc_burrito::validate_dir(&capsule.join(PROJECT));
        assert!(
            problems.is_empty(),
            "INV-OLD-PROJECTS-OPEN-UNCHANGED: {what} is not a valid burrito: {problems:#?}"
        );
        let (computer, folder) = opened(
            work.path(),
            &format!("open-{version}-{name}"),
            &capsule,
            name,
        );
        let handle = computer.open(&folder);
        assert!(
            handle.facts().mode.is_writable(),
            "INV-OLD-PROJECTS-OPEN-UNCHANGED: {what} opened {:?}",
            handle.facts().mode
        );
        no_damage(&handle, &what);
        let got = expectation(handle.snapshot().fold());
        let want = expect_of(&capsule);
        if got != want {
            let got_text = String::from_utf8(expectation_bytes(&got)).unwrap();
            let want_text = String::from_utf8(expectation_bytes(&want)).unwrap();
            let first = got_text
                .lines()
                .zip(want_text.lines())
                .enumerate()
                .find(|(_, (g, w))| g != w)
                .map_or_else(
                    || {
                        format!(
                            "{} lines read, {} expected",
                            got_text.lines().count(),
                            want_text.lines().count()
                        )
                    },
                    |(n, (g, w))| format!("line {}: read {g:?}, expected {w:?}", n + 1),
                );
            panic!(
                "INV-OLD-PROJECTS-OPEN-UNCHANGED: {what} projects differently from EXPECT.json; {first}"
            );
        }
        handle.close().unwrap();
        let problems = computer.problems();
        assert!(
            problems.is_empty(),
            "INV-OLD-PROJECTS-OPEN-UNCHANGED: opening {what} wrote a state that is not a valid burrito: {problems:#?}"
        );
    }
}

fn frame_key() -> RecordKey {
    RecordKey::Frame(StoryNo::new(1).unwrap(), FrameNo::new(1))
}

fn frame_text(handle: &ProjectHandle) -> Option<String> {
    match handle.snapshot().fold().projected(&frame_key()) {
        Some(Record::Frame { value, .. }) => Some(value),
        _ => None,
    }
}

/// Edits one unit of the project with the current build and answers what to read back:
/// a verse of a Bible, the first frame of a story project.
fn edit(handle: &ProjectHandle, words: &str) {
    match handle.facts().kind {
        ProjectKind::Bible => {
            save_verse(handle, 1, 1, words);
        }
        ProjectKind::Stories => {
            let shown = handle.mint(&frame_key(), None).unwrap();
            handle
                .submit(Command::SaveFrame {
                    shown,
                    text: words.to_owned(),
                })
                .wait()
                .unwrap();
        }
    }
}

fn read_back(handle: &ProjectHandle) -> Option<String> {
    match handle.facts().kind {
        ProjectKind::Bible => words(handle, 1, 1),
        ProjectKind::Stories => frame_text(handle),
    }
}

/// INV-OLD-PROJECTS-OPEN-UNCHANGED: on a copy of every capsule, the current build saves an
/// edit, makes a checkpoint that commits it, writes an exchange file, and a teammate with
/// another copy of the capsule receives the file and reads the edit back.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn every_capsule_edits_saves_and_exchanges() {
    let work = tempfile::tempdir().unwrap();
    let stick = work.path().join("stick");
    std::fs::create_dir_all(&stick).unwrap();
    for (version, name, capsule) in capsules() {
        let what = format!("capsule {version}/{name}");
        let edited = format!("Edited in {what} by format {}", this_version());
        let (ana, folder_a) = opened(
            work.path(),
            &format!("ana-{version}-{name}"),
            &capsule,
            name,
        );
        let (juan, folder_b) = opened(
            work.path(),
            &format!("juan-{version}-{name}"),
            &capsule,
            name,
        );
        let a = ana.open(&folder_a);
        edit(&a, &edited);
        assert_eq!(read_back(&a).as_deref(), Some(edited.as_str()), "{what}");
        let report = a
            .checkpoint(CheckpointReason::Other("capsule test".into()))
            .wait()
            .unwrap();
        assert!(
            report.commit.is_some(),
            "INV-OLD-PROJECTS-OPEN-UNCHANGED: the checkpoint of {what} made no commit: {:?}",
            report.skipped
        );
        let file = export(&a, &stick, "Ana").await.unwrap();
        let b = juan.open(&folder_b);
        let received = receive(&b, &file, "Ana").await.unwrap();
        assert!(received.intake.packs > 0, "{what}: {received:?}");
        assert_eq!(
            read_back(&b).as_deref(),
            Some(edited.as_str()),
            "INV-OLD-PROJECTS-OPEN-UNCHANGED: {what}: the teammate did not receive the edit"
        );
        no_damage(&a, &what);
        no_damage(&b, &what);
        a.close().unwrap();
        b.close().unwrap();
        for (computer, who) in [(&ana, "Ana"), (&juan, "Juan")] {
            let problems = computer.problems();
            assert!(problems.is_empty(), "{what}, {who}: {problems:#?}");
        }
    }
}

/// §12.2 rule 2 on a frozen sample: the `mixed-minor` capsule's changes from a newer minor
/// are read with their known fields (the newer verse is the shown version), the unknown kind
/// is counted and kept, and after a save and a checkpoint by this build their bytes are still
/// in the project, byte for byte.
#[test]
fn a_capsule_with_newer_minor_changes_opens_and_keeps_them() {
    let work = tempfile::tempdir().unwrap();
    for (version, dir) in versions() {
        let capsule = dir.join(MIXED_MINOR);
        let what = format!("capsule {version}/{MIXED_MINOR}");
        let (computer, folder) = opened(
            work.path(),
            &format!("mixed-{version}"),
            &capsule,
            MIXED_MINOR,
        );
        let handle = computer.open(&folder);
        assert!(handle.facts().mode.is_writable(), "{what}");
        let fold = handle.snapshot();
        let newer: Vec<(tc_journal::ChangeId, std::sync::Arc<[u8]>)> = fold
            .fold()
            .record_keys()
            .iter()
            .flat_map(|key| fold.fold().history(key))
            .filter(|id| {
                fold.fold()
                    .body(id)
                    .is_some_and(|b| b.v > tc_journal::FORMAT_MINOR)
            })
            .map(|id| (id, fold.fold().raw(&id).unwrap()))
            .collect();
        assert!(
            newer.len() >= 2,
            "{what} holds {} changes of a newer minor; the capsule has a known kind with a newer field and an unknown kind",
            newer.len()
        );
        // Equality, not a substring: the older wording is a prefix of the newer one.
        let newer_words: Vec<String> = newer
            .iter()
            .filter_map(|(_, raw)| {
                let line: serde_json::Value = serde_json::from_slice(raw).unwrap();
                let verse = line.pointer("/record/verse")?;
                if verse["book"] != "TIT" || verse["chapter"] != 1 || verse["verse"] != 1 {
                    return None;
                }
                verse.pointer("/value/text/words")?.as_str().map(String::from)
            })
            .collect();
        assert_eq!(
            newer_words.len(),
            1,
            "{what} holds one newer-minor change of Titus 1:1"
        );
        let shown = words(&handle, 1, 1).unwrap();
        assert_eq!(
            shown,
            newer_words[0],
            "{what}: the newer minor's verse is the version shown"
        );
        assert!(
            fold.fold().anomalies().any(|a| matches!(
                a,
                tc_journal::fold::Anomaly::UnknownKinds { changes, .. } if *changes >= 1
            )),
            "{what}: the unknown kind is counted"
        );
        drop(fold);
        save_verse(
            &handle,
            1,
            2,
            "a save by the current build beside the newer changes",
        );
        handle
            .checkpoint(CheckpointReason::Other("capsule test".into()))
            .wait()
            .unwrap();
        handle.close().unwrap();
        let packs = files_under(&folder.join("ingredients/tc/changes"));
        for (id, raw) in &newer {
            assert!(
                packs
                    .values()
                    .any(|bytes| bytes.windows(raw.len()).any(|w| w == &raw[..])),
                "{what}: the newer change {id} is no longer in the project's packs byte for byte"
            );
        }
        let problems = computer.problems();
        assert!(problems.is_empty(), "{what}: {problems:#?}");
    }
}
