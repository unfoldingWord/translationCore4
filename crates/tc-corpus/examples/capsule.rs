//! Writes the capsule set of a format version (`docs/STORAGE.md` §12.3, PLAN P10, #865):
//!
//! ```text
//! cargo run -p tc-corpus --example capsule -- write <version> <dir>
//! ```
//!
//! `<version>` must be the format this build writes (`FORMAT_MAJOR.FORMAT_MINOR`), and `<dir>`
//! must not exist yet: a frozen capsule is never rewritten. Each capsule is a sample project
//! written through the real store from the repository's fixtures, never from a person's
//! project, then copied as it leaves the app (every file but `.git/` and `.tc/`) under
//! `<dir>/<name>/project/`, with `EXPECT.json` (the projection read back through the store)
//! and `LOCK.sha256` beside it. The run then opens every capsule again from its copy and
//! checks that the projection equals `EXPECT.json` and that the folder is a valid Scripture
//! Burrito, so the set is known to open before it is committed.
//!
//! A sample no product path writes yet (the record of a tC4 import; a newer minor's inert
//! field) is assembled from tc-journal's encodings as a teammate's sealed pack, as
//! `fixtures/journal/v0-every-kind.ndjson` pins every cause: the pin is on what every reader
//! must keep reading.
//!
//! ```text
//! cargo run -p tc-corpus --example capsule -- reader-folders <dir>
//! ```
//!
//! writes the three folders the `format-older-reader` gate (§12.3 step 4,
//! `scripts/older-reader.sh`) hands the build of the last frozen version: `plain`, a
//! project this build wrote; `newer-minor`, the same with a `minReaderMinor` above this
//! build's minor; `newer-major`, the same with the next major.

#![allow(
    clippy::expect_used,
    clippy::unwrap_used,
    clippy::panic,
    reason = "a generator stops at its first failure, with the reason"
)]

#[path = "capsule/support.rs"]
mod support;

use std::path::{Path, PathBuf};
use support::*;
use tc_journal::command::{
    AlignmentEdit, Command, DecisionBasis, DecisionChange, DecisionEdit, SeedSource,
};
use tc_journal::fold::ProjectKind;
use tc_journal::keys::{CheckId, CheckKey, CheckTarget, RefPart, ToolId};
use tc_journal::line::{encode_line, read_line};
use tc_journal::outside::UpdatePart;
use tc_journal::pack::{PackSpec, seal};
use tc_journal::pending::{PendingHeader, Purpose, encode_pending};
use tc_journal::record::{
    AlignmentGroup, CarriedValue, CommentTarget, MarkerWs, ResourceRef, Scope, SourceWord,
    TargetWord, UserStatus, VerseValue, VersificationValue,
};
use tc_journal::{
    BatchId, BatchRef, Cause, Change, ChangeBody, ChangeId, DeviceId, DeviceKind, DeviceSeq,
    FORMAT_MINOR, FrameNo, GitOid, ImportSource, Json, JsonMap, Md5, MetaField, MetaPath,
    ProjectId, Record, RecordKey, RepoPath, StoryNo, Verified, WallTime,
};
use tc_store::{BookText, CheckpointReason, Leave, NewProject, ProjectHandle};
use tc_sync::exchange::{export, receive};

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let (version, dir) = match args.as_slice() {
        [write, version, dir] if write == "write" => (version.as_str(), PathBuf::from(dir)),
        [folders, dir] if folders == "reader-folders" => {
            reader_folders(&PathBuf::from(dir));
            return;
        }
        _ => {
            eprintln!(
                "usage: cargo run -p tc-corpus --example capsule -- write <version> <dir> | reader-folders <dir>"
            );
            std::process::exit(2);
        }
    };
    if version != this_version() {
        eprintln!(
            "capsule: this build writes format {}, not {version}; a capsule set is written by the build of its version",
            this_version()
        );
        std::process::exit(2);
    }
    if dir.exists() {
        eprintln!(
            "capsule: {} exists; a frozen capsule set is never rewritten. Choose a new folder",
            dir.display()
        );
        std::process::exit(2);
    }
    let work = tempfile::tempdir().unwrap();
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .worker_threads(2)
        .enable_all()
        .build()
        .unwrap();
    std::fs::create_dir_all(&dir).unwrap();
    for name in CAPSULES {
        let (computer, folder) = scenario(name, work.path(), &runtime);
        let handle = computer.open(&folder);
        let expect = expectation(handle.snapshot().fold());
        handle.close().unwrap();
        let problems = computer.problems();
        assert!(
            problems.is_empty(),
            "{name}: the store wrote a state that is not a valid burrito: {problems:#?}"
        );
        let capsule = dir.join(name);
        copy_project(&folder, &capsule.join(PROJECT));
        std::fs::write(capsule.join(EXPECT), expectation_bytes(&expect)).unwrap();
        std::fs::write(capsule.join(LOCK), lock_of(&capsule)).unwrap();
        println!("wrote {name}: {} files", files_under(&capsule).len() - 1);
    }
    verify(&dir, work.path());
    println!(
        "capsule set {} written to {}; commit it, then freeze it with FROZEN (§12.3)",
        this_version(),
        dir.display()
    );
}

/// Opens every capsule from its copy with a fresh store and checks it against its own
/// `EXPECT.json` and as a burrito.
fn verify(dir: &Path, work: &Path) {
    for name in CAPSULES {
        let capsule = dir.join(name);
        let problems = tc_burrito::validate_dir(&capsule.join(PROJECT));
        assert!(
            problems.is_empty(),
            "{name}: the capsule is not a valid burrito: {problems:#?}"
        );
        let computer = Computer::new(work, &format!("verify-{name}"));
        let folder = computer.projects.join(name);
        copy_tree(&capsule.join(PROJECT), &folder, &|_| true);
        let handle = computer.open(&folder);
        let got = expectation(handle.snapshot().fold());
        handle.close().unwrap();
        let want: serde_json::Value =
            serde_json::from_slice(&std::fs::read(capsule.join(EXPECT)).unwrap()).unwrap();
        assert!(
            got == want,
            "{name}: opened from its copy, the projection differs from EXPECT.json"
        );
        let problems = computer.problems();
        assert!(problems.is_empty(), "{name}: {problems:#?}");
        println!("verified {name}");
    }
}

/// The three folders of the `format-older-reader` gate: a Titus project this build wrote
/// with a verse saved, then copies of it whose `format.json` carries a `minReaderMinor` this
/// build's minor is below, and the next major (§12.2 rules 1 and 2). The copies keep `.git/`
/// and `.tc/` as the folder has them after a close, as a project moved to another computer
/// does.
fn reader_folders(dir: &Path) {
    if dir.exists() {
        eprintln!("capsule: {} exists; choose a new folder", dir.display());
        std::process::exit(2);
    }
    let work = tempfile::tempdir().unwrap();
    let computer = Computer::new(work.path(), "current");
    let folder = titus(&computer, "plain");
    let handle = computer.open(&folder);
    save_verse(
        &handle,
        1,
        2,
        "in hope of eternal life, saved by the current build",
    );
    leave_book(&handle);
    checkpoint(&handle);
    handle.close().unwrap();
    let problems = computer.problems();
    assert!(problems.is_empty(), "{problems:#?}");
    std::fs::create_dir_all(dir).unwrap();
    let keep = |name: &str| name != "lock";
    for name in ["plain", "newer-minor", "newer-major"] {
        copy_tree(&folder, &dir.join(name), &keep);
    }
    let mut newer_minor = tc_journal::FormatDoc::current();
    newer_minor.minor = u64::from(FORMAT_MINOR + 1).into();
    newer_minor.min_reader_minor = u64::from(FORMAT_MINOR + 1).into();
    let mut newer_major = tc_journal::FormatDoc::current();
    newer_major.major = u64::from(tc_journal::FORMAT_MAJOR + 1).into();
    for (name, doc) in [("newer-minor", newer_minor), ("newer-major", newer_major)] {
        std::fs::write(
            dir.join(name).join(tc_journal::format::FORMAT_PATH),
            doc.to_bytes(),
        )
        .unwrap();
    }
    println!(
        "reader folders written to {}: plain, newer-minor (minReaderMinor {}), newer-major (major {})",
        dir.display(),
        FORMAT_MINOR + 1,
        tc_journal::FORMAT_MAJOR + 1
    );
}

// ---------------------------------------------------------------------------------------
// The scenarios
// ---------------------------------------------------------------------------------------

/// Writes the capsule `name` and answers its store and its project folder, closed.
fn scenario(name: &str, work: &Path, runtime: &tokio::runtime::Runtime) -> (Computer, PathBuf) {
    let computer = Computer::new(work, name);
    let folder = match name {
        "bible-titus" => bible_titus(&computer),
        "stories" => stories(&computer),
        "exchanged" => exchanged(&computer, work, runtime),
        "imported-tc4" => imported_tc4(&computer),
        "imported-usfm" => imported_usfm(&computer),
        "updated-book" => updated_book(&computer),
        "held-outside" => held_outside(&computer),
        "mixed-minor" => mixed_minor(&computer),
        "carried" => carried(&computer),
        _ => panic!("no capsule named {name}"),
    };
    (computer, folder)
}

fn ult(book: &str) -> String {
    std::fs::read_to_string(
        repo_root().join(format!("fixtures/tc4/test-fixtures/en_ult/{book}.usfm")),
    )
    .unwrap()
}

fn json(text: &str) -> Json {
    tc_journal::json::parse(text.as_bytes()).unwrap()
}

/// The records a new Bible project starts with: its details and versification.
fn first_records(name: &str, abbreviation: &str) -> Vec<Record> {
    let meta = |field: MetaField, value: &str| Record::ProjectMeta {
        field,
        value: Some(json(value)),
    };
    let extra = |path: &str| MetaField::Extra(MetaPath::parse(path).unwrap());
    vec![
        meta(MetaField::Name, &format!(r#"{{"en":"{name}"}}"#)),
        meta(
            MetaField::Abbreviation,
            &format!(r#"{{"en":"{abbreviation}"}}"#),
        ),
        meta(
            MetaField::Languages,
            r#"[{"name":{"en":"English"},"scriptDirection":"ltr","tag":"en"}]"#,
        ),
        meta(extra("meta.dateCreated"), r#""2026-10-17T00:00:00.000Z""#),
        meta(extra("meta.defaultLocale"), r#""en""#),
        Record::Versification {
            value: VersificationValue {
                name: Some("eng".into()),
                bytes: tc_versification::StandardScheme::Eng.json().to_owned(),
            },
        },
    ]
}

/// A Titus project seeded from the ULT, as New Bible makes one.
fn titus(computer: &Computer, folder_name: &str) -> PathBuf {
    computer
        .store
        .create(&NewProject {
            name: folder_name.to_owned(),
            kind: ProjectKind::Bible,
            records: first_records("Titus test translation", "ttt"),
            books: vec![(TIT, Scope::Whole, SeedSource { usfm: ult("TIT") })],
            texts: Vec::new(),
            carried: Vec::new(),
        })
        .unwrap()
}

fn checkpoint(handle: &ProjectHandle) {
    handle
        .checkpoint(CheckpointReason::Other("capsule".into()))
        .wait()
        .unwrap();
    handle.wait_idle();
}

fn leave_book(handle: &ProjectHandle) {
    handle.leave(Leave::Book(TIT)).wait().unwrap();
    handle.wait_idle();
}

fn tn_key(c: u16, v: u16) -> CheckKey {
    CheckKey {
        tool: ToolId::TranslationNotes,
        check_id: CheckId::parse("abcd").unwrap(),
        target: CheckTarget::Verse {
            book: TIT,
            chapter: RefPart::parse(&c.to_string()).unwrap(),
            verse: RefPart::parse(&v.to_string()).unwrap(),
        },
        occurrence: 1,
    }
}

fn decision(changes: Vec<DecisionChange>) -> DecisionEdit {
    DecisionEdit {
        basis: Some(DecisionBasis {
            context: JsonMap::from([("checkId".to_owned(), Json::from("abcd"))]),
            category: Some("figures".into()),
        }),
        resource: ResourceRef {
            repo_path: "git.door43.org/unfoldingWord/en_tn".into(),
            sha: GitOid::parse(&format!("{:040x}", 7)).unwrap(),
        },
        changes,
    }
}

fn alignment(word: &str) -> AlignmentEdit {
    AlignmentEdit {
        alignments: vec![AlignmentGroup {
            top_words: vec![SourceWord {
                word: "Παῦλος".into(),
                strong: None,
                lemma: Some("Παῦλος".into()),
                morph: None,
                occurrence: 1,
                occurrences: 1,
                extra: Default::default(),
            }],
            bottom_words: vec![TargetWord {
                word: word.into(),
                occurrence: 1,
                occurrences: 1,
                extra: Default::default(),
            }],
            extra: Default::default(),
        }],
        word_bank: Vec::new(),
        done: false,
    }
}

fn submit(handle: &ProjectHandle, command: Command) {
    handle.submit(command).wait().unwrap();
}

fn token(handle: &ProjectHandle, key: &RecordKey) -> tc_journal::ShownToken {
    handle.mint(key, None).unwrap()
}

/// Who wrote a hand-built change: its device, and the sequence number and batch it takes.
struct Author {
    device: DeviceId,
    seq: u64,
    batch: BatchRef,
}

/// A verse change of TIT `c:v`, built as a teammate's app would build it.
fn verse_body(
    author: Author,
    (c, v): (u16, u16),
    words: &str,
    parents: Vec<ChangeId>,
    cause: Cause,
) -> ChangeBody {
    let Author { device, seq, batch } = author;
    ChangeBody {
        v: FORMAT_MINOR,
        record: Record::Verse {
            book: TIT,
            chapter: tc_journal::ChapterNo::new(c).unwrap(),
            verse: tc_journal::VerseNo::new(v).unwrap(),
            value: VerseValue::Text {
                marker: MarkerWs::canonical(),
                words: words.into(),
                layout: "\n".into(),
                last: tc_journal::VerseNo::new(v).unwrap(),
                from: None,
            },
        },
        parents,
        device,
        seq: DeviceSeq(seq),
        at: WallTime(CLOCK_MS - 60_000 + seq as i64),
        batch,
        cause,
    }
}

fn batch(seed: u8, n: u32) -> BatchRef {
    BatchRef::new(BatchId::from_bytes([seed; 16]), n).unwrap()
}

/// Writes `lines` as a teammate's pending save into the folder's `.tc/pending/`.
fn teammate_pending(folder: &Path, project: ProjectId, device: DeviceId, lines: &[Verified]) {
    let file = encode_pending(
        &PendingHeader {
            device,
            project,
            purpose: Purpose::Save,
            reconciles: None,
        },
        lines,
    )
    .unwrap();
    let dir = folder.join(".tc/pending");
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(dir.join(file.name), file.bytes).unwrap();
}

/// Writes `lines` as a pack another device sealed, as a receive leaves one in the folder.
fn teammate_pack(folder: &Path, project: ProjectId, sealer: DeviceId, lines: &[Verified]) {
    let sealed = seal(
        &PackSpec {
            project,
            sealer,
            sealed: WallTime(CLOCK_MS - 30_000),
        },
        lines,
    )
    .unwrap();
    assert!(sealed.set_aside.is_empty());
    for pack in sealed.packs {
        let path = folder.join(pack.path.to_string());
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, pack.bytes).unwrap();
    }
}

/// `bible-titus`: verses, an alignment, check decisions, a comment, history (a verse saved
/// twice, a decision changed), and a verse-text conflict with a teammate.
fn bible_titus(computer: &Computer) -> PathBuf {
    let folder = titus(computer, "bible-titus");
    let handle = computer.open(&folder);
    save_verse(&handle, 1, 1, "Paul, a servant of God");
    save_verse(&handle, 1, 2, "in hope of eternal life");
    save_verse(&handle, 1, 3, "but at the right time");
    save_verse(&handle, 1, 1, "Paul, a servant of God and an apostle");
    submit(
        &handle,
        Command::SaveAlignment {
            shown: token(
                &handle,
                &RecordKey::Alignment(
                    TIT,
                    tc_journal::ChapterNo::new(1).unwrap(),
                    tc_journal::VerseNo::new(1).unwrap(),
                ),
            ),
            verse_shown: token(&handle, &verse(1, 1)),
            value: alignment("Paul"),
        },
    );
    submit(
        &handle,
        Command::SaveDecision {
            shown: token(&handle, &RecordKey::Check(tn_key(1, 2))),
            verse_shown: token(&handle, &verse(1, 2)),
            value: decision(vec![DecisionChange::Status(Some(UserStatus::Valid))]),
        },
    );
    submit(
        &handle,
        Command::SaveDecision {
            shown: token(&handle, &RecordKey::Check(tn_key(1, 2))),
            verse_shown: token(&handle, &verse(1, 2)),
            value: decision(vec![DecisionChange::Bookmarked(true)]),
        },
    );
    submit(
        &handle,
        Command::AddComment {
            target: CommentTarget::Verse {
                book: TIT,
                chapter: tc_journal::ChapterNo::new(1).unwrap(),
                verse: tc_journal::VerseNo::new(2).unwrap(),
            },
            text: "Check eternal".into(),
        },
    );
    let project = handle.facts().id;
    leave_book(&handle);
    handle.close().unwrap();
    // A teammate changed 1:3 from the seed too, concurrently: both versions are kept and shown.
    let teammate = DeviceId::local([7; 15]);
    let change = Change::new(verse_body(
        Author {
            device: teammate,
            seq: 1,
            batch: batch(7, 1),
        },
        (1, 3),
        "but in due season",
        Vec::new(),
        Cause::Edit,
    ))
    .unwrap();
    teammate_pending(&folder, project, teammate, &[change.into()]);
    let handle = computer.open(&folder);
    leave_book(&handle);
    checkpoint(&handle);
    handle.close().unwrap();
    folder
}

/// `stories`: an Open Bible Stories project as New Stories makes one, with one frame saved.
fn stories(computer: &Computer) -> PathBuf {
    let mut records: Vec<Record> = first_records("Stories test translation", "stt")
        .into_iter()
        .filter(|r| !matches!(r, Record::Versification { .. }))
        .collect();
    for story in tc_obs::ids::StoryNo::all() {
        records.push(Record::StoryBase {
            story: StoryNo::new(story.get()).unwrap(),
            value: tc_obs::story::seed_story(tc_obs::template::template_story(story)).unwrap(),
        });
    }
    let folder = computer
        .store
        .create(&NewProject {
            name: "stories".into(),
            kind: ProjectKind::Stories,
            records,
            books: Vec::new(),
            texts: Vec::new(),
            carried: Vec::new(),
        })
        .unwrap();
    let handle = computer.open(&folder);
    let frame = RecordKey::Frame(StoryNo::new(1).unwrap(), FrameNo::new(1));
    submit(
        &handle,
        Command::SaveFrame {
            shown: token(&handle, &frame),
            text: "This is how the beginning of everything happened.".into(),
        },
    );
    checkpoint(&handle);
    handle.close().unwrap();
    folder
}

/// `exchanged`: Ana's project goes to Juan as an exchange file, Juan saves and sends a file
/// back, Ana receives it. The capsule is Ana's folder.
fn exchanged(ana: &Computer, work: &Path, runtime: &tokio::runtime::Runtime) -> PathBuf {
    let stick = work.join("stick");
    std::fs::create_dir_all(&stick).unwrap();
    let folder_a = titus(ana, "exchanged");
    let a = ana.open(&folder_a);
    save_verse(&a, 1, 1, "Paul, as Ana has it");
    let from_ana = runtime.block_on(export(&a, &stick, "Ana")).unwrap();
    let juan = Computer::new(work, "exchanged-juan");
    let folder_b = juan.projects.join("exchanged");
    copy_project(&folder_a, &folder_b);
    let b = juan.open(&folder_b);
    runtime.block_on(receive(&b, &from_ana, "Ana")).unwrap();
    save_verse(&b, 1, 2, "in hope, as Juan has it");
    let from_juan = runtime.block_on(export(&b, &stick, "Juan")).unwrap();
    b.close().unwrap();
    runtime.block_on(receive(&a, &from_juan, "Juan")).unwrap();
    assert_eq!(words(&a, 1, 2).as_deref(), Some("in hope, as Juan has it"));
    checkpoint(&a);
    a.close().unwrap();
    assert!(juan.problems().is_empty(), "{:#?}", juan.problems());
    folder_a
}

/// `imported-tc4`: the record of a tC4 import (§13.1): a tC4 actor's change with cause
/// `Import(Tc4 { actor, ts, op })`, and the importer's reconcile change with
/// `Import(Tc4Reconcile)`, in a pack the importing device sealed. No product path writes
/// these yet (the tC4 4.0 importer is not built), so they are assembled from tc-journal's
/// encodings; the format holds them and every reader must keep reading them.
fn imported_tc4(computer: &Computer) -> PathBuf {
    let folder = titus(computer, "imported-tc4");
    let handle = computer.open(&folder);
    let project = handle.facts().id;
    let fold = handle.snapshot();
    let heads_1 = fold.fold().heads(&verse(1, 1));
    let heads_2 = fold.fold().heads(&verse(1, 2));
    drop(fold);
    handle.close().unwrap();
    let actor = DeviceId::derived(DeviceKind::Tc4Actor, b"tc4-actor\0a1b2c3");
    let importer = DeviceId::derived(DeviceKind::Importer, b"import\0tc4-reconcile\0capsule");
    let converted = Change::new(verse_body(
        Author {
            device: actor,
            seq: 1,
            batch: batch(0xa1, 1),
        },
        (1, 1),
        "Paul, a servant of God, imported from translationCore 4",
        heads_1,
        Cause::Import(ImportSource::Tc4 {
            actor: "a1b2c3".into(),
            ts: "2026-09-01T12:00:00.000Z".into(),
            op: "text.verse.set".into(),
        }),
    ))
    .unwrap();
    let reconciled = Change::new(verse_body(
        Author {
            device: importer,
            seq: 1,
            batch: batch(0xa2, 1),
        },
        (1, 2),
        "in hope of eternal life, as translationCore 4 showed it",
        heads_2,
        Cause::Import(ImportSource::Tc4Reconcile),
    ))
    .unwrap();
    teammate_pack(
        &folder,
        project,
        DeviceId::local([9; 15]),
        &[converted.into(), reconciled.into()],
    );
    let handle = computer.open(&folder);
    assert_eq!(
        words(&handle, 1, 1).as_deref(),
        Some("Paul, a servant of God, imported from translationCore 4")
    );
    leave_book(&handle);
    checkpoint(&handle);
    handle.close().unwrap();
    folder
}

/// `imported-usfm`: a project made from a USFM file (§13.5): its book's records carry
/// `Import(Usfm { fileName, unknownBase })`.
fn imported_usfm(computer: &Computer) -> PathBuf {
    let folder = computer
        .store
        .create(&NewProject {
            name: "imported-usfm".into(),
            kind: ProjectKind::Bible,
            records: first_records("Titus from a file", "tff"),
            books: Vec::new(),
            texts: vec![BookText {
                book: TIT,
                scope: Scope::Whole,
                usfm: ult("TIT"),
                file_name: "57-TIT.usfm".into(),
            }],
            carried: Vec::new(),
        })
        .unwrap();
    let handle = computer.open(&folder);
    save_verse(&handle, 1, 1, "Paul, a servant of God, after the import");
    leave_book(&handle);
    checkpoint(&handle);
    handle.close().unwrap();
    folder
}

/// `bytes` with the text of TIT c:v replaced; a verse the project has no text for shows
/// `___` in the file.
fn set_verse(usfm: &str, c: u16, v: u16, text: &str) -> String {
    let chapter = usfm.find(&format!("\n\\c {c}\n")).unwrap();
    let marker = format!("\\v {v} ");
    let at = chapter + usfm[chapter..].find(&marker).unwrap() + marker.len();
    let end = at + usfm[at..].find('\n').unwrap();
    format!("{}{}{}", &usfm[..at], text, &usfm[end..])
}

/// `updated-book`: "Update a book from USFM" (§13.6) with a file that fills an empty verse
/// and differs on a verse the project has: the fill comes in, the difference is a conflict
/// with no parents (`unknownBase`), and the project's words stay shown.
fn updated_book(computer: &Computer) -> PathBuf {
    let folder = titus(computer, "updated-book");
    let handle = computer.open(&folder);
    save_verse(&handle, 1, 1, "Paul, a servant of God");
    let book = handle.snapshot().fold().book_usfm(TIT).unwrap();
    let file = set_verse(&book, 1, 1, "Paul, a slave of God");
    let file = set_verse(&file, 1, 2, "in hope of eternal life, from the file");
    for part in [UpdatePart::Fill, UpdatePart::Review] {
        submit(
            &handle,
            Command::UpdateBook {
                book: TIT,
                bytes: file.clone().into_bytes(),
                file_name: "TIT.usfm".into(),
                part,
            },
        );
    }
    assert_eq!(
        words(&handle, 1, 2).as_deref(),
        Some("in hope of eternal life, from the file")
    );
    assert_eq!(
        words(&handle, 1, 1).as_deref(),
        Some("Paul, a servant of God")
    );
    leave_book(&handle);
    checkpoint(&handle);
    handle.close().unwrap();
    folder
}

/// `held-outside`: the book file was changed by another program while the app was closed;
/// the open keeps the file as it is and asks (§11.1). The project's text does not change.
fn held_outside(computer: &Computer) -> PathBuf {
    let folder = titus(computer, "held-outside");
    let handle = computer.open(&folder);
    save_verse(&handle, 1, 1, "Paul, a servant of God");
    leave_book(&handle);
    checkpoint(&handle);
    handle.close().unwrap();
    let path = folder.join("ingredients/TIT.usfm");
    let edited = set_verse(
        &std::fs::read_to_string(&path).unwrap(),
        1,
        2,
        "in hope of eternal life, typed in another program",
    );
    std::fs::write(&path, edited).unwrap();
    let handle = computer.open(&folder);
    assert_ne!(
        words(&handle, 1, 2).as_deref(),
        Some("in hope of eternal life, typed in another program"),
        "nothing enters without Import"
    );
    checkpoint(&handle);
    handle.close().unwrap();
    folder
}

/// `mixed-minor`: a newer minor's changes among this minor's (§12.2 rule 2): a verse with a
/// field minor 0 does not know, and a record kind it does not know, both inert. Built as
/// `fixtures/journal/make_newer_minor.py` builds its lines, since this build cannot write
/// `v: 1`.
fn mixed_minor(computer: &Computer) -> PathBuf {
    let folder = titus(computer, "mixed-minor");
    let handle = computer.open(&folder);
    save_verse(&handle, 1, 1, "Paul, a servant of God");
    let project = handle.facts().id;
    let heads = handle.snapshot().fold().heads(&verse(1, 1));
    leave_book(&handle);
    checkpoint(&handle);
    handle.close().unwrap();
    let newer = DeviceId::local([11; 15]);
    // The verse as minor 0 writes it, then the newer minor's members added at three levels.
    let base = Change::new(verse_body(
        Author {
            device: newer,
            seq: 1,
            batch: batch(11, 1),
        },
        (1, 1),
        "Paul, a servant of God, saved by a newer translationCore",
        heads,
        Cause::Edit,
    ))
    .unwrap();
    let mut body = tc_journal::json::parse(base.raw()).unwrap();
    let Json::Obj(map) = &mut body else {
        panic!("a change is an object")
    };
    map.insert("v".into(), Json::from(1u64));
    map.insert("sig".into(), Json::from("ed25519:…"));
    let text = ["record", "verse", "value", "text"]
        .iter()
        .fold(&mut *map, |map, member| match map.get_mut(member) {
            Some(Json::Obj(inner)) => inner,
            _ => panic!("the verse's text is an object"),
        });
    text.insert("note".into(), Json::from("a newer field"));
    let note_thread = format!(
        r#"{{"at":{at},"batch":{{"id":"{batch}","n":1}},"cause":{{"edit":{{}}}},"device":"{newer}","parents":[],"record":{{"noteThread":{{"book":"TIT","thread":"a1","value":{{"title":"Paul"}}}}}},"seq":2,"v":1}}"#,
        at = CLOCK_MS - 59_000,
        batch = "0b".repeat(16),
    );
    let lines: Vec<Verified> = [body.to_canonical(), note_thread.into_bytes()]
        .iter()
        .map(|bytes| {
            // A reader sees a line without its line feed.
            let line = encode_line(ChangeId::of(bytes), bytes);
            read_line(line.strip_suffix(b"\n").unwrap()).unwrap()
        })
        .collect();
    assert!(
        lines.iter().all(|line| line.as_change().is_some()),
        "both lines read as changes of a newer minor: {lines:?}"
    );
    teammate_pack(&folder, project, newer, &lines);
    let handle = computer.open(&folder);
    assert_eq!(
        words(&handle, 1, 1).as_deref(),
        Some("Paul, a servant of God, saved by a newer translationCore"),
        "the newer minor's verse is the newest version, its known fields shown"
    );
    leave_book(&handle);
    checkpoint(&handle);
    handle.close().unwrap();
    folder
}

/// `carried`: files the app keeps verbatim (§11.4): one of this computer's, and a
/// teammate's whose path differs from it only in case, placed at a `.case-` path (§3.3).
fn carried(computer: &Computer) -> PathBuf {
    let mine: Vec<u8> = (0..3000u32).map(|i| (i % 251) as u8).collect();
    let folder = computer
        .store
        .create(&NewProject {
            name: "carried".into(),
            kind: ProjectKind::Bible,
            records: first_records("Titus with recordings", "twr"),
            books: vec![(TIT, Scope::Whole, SeedSource { usfm: ult("TIT") })],
            texts: Vec::new(),
            carried: vec![
                ("ingredients/audio/Intro.mp3".into(), mine.clone()),
                (
                    "ingredients/notes/README.txt".into(),
                    b"Notes the team keeps beside the text.\n".to_vec(),
                ),
            ],
        })
        .unwrap();
    let handle = computer.open(&folder);
    let project = handle.facts().id;
    let git_dir = handle
        .facts()
        .git_dir
        .expect("a created project has a repository");
    let theirs = b"Juan's intro, recorded on another computer".to_vec();
    // A teammate's bytes arrive as a blob, as a receive or a pull stores them.
    let oid = git2::Repository::open(&git_dir)
        .unwrap()
        .blob(&theirs)
        .unwrap();
    handle.close().unwrap();
    let teammate = DeviceId::local([5; 15]);
    let change = Change::new(ChangeBody {
        v: FORMAT_MINOR,
        record: Record::CarriedFile {
            path: RepoPath::parse("ingredients/audio/intro.mp3").unwrap(),
            value: CarriedValue::Present {
                oid: GitOid::parse(&oid.to_string()).unwrap(),
                size: theirs.len() as u64,
                md5: Md5::of(&theirs),
            },
        },
        parents: Vec::new(),
        device: teammate,
        seq: DeviceSeq(1),
        at: WallTime(CLOCK_MS - 50_000),
        batch: batch(5, 1),
        cause: Cause::Edit,
    })
    .unwrap();
    teammate_pending(&folder, project, teammate, &[change.into()]);
    let handle = computer.open(&folder);
    handle.focus().wait().unwrap();
    handle.wait_idle();
    let places = handle.snapshot().fold().carried_files();
    let aside = places
        .iter()
        .find(|p| p.record.as_str() == "ingredients/audio/intro.mp3")
        .expect("the teammate's file is placed");
    assert!(aside.path.contains(".case-"), "{}", aside.path);
    assert_eq!(std::fs::read(folder.join(&aside.path)).unwrap(), theirs);
    assert_eq!(
        std::fs::read(folder.join("ingredients/audio/Intro.mp3")).unwrap(),
        mine
    );
    checkpoint(&handle);
    handle.close().unwrap();
    folder
}
