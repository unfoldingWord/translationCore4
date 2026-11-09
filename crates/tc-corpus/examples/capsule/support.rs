//! What the capsule generator (`examples/capsule.rs`) and the capsule tests
//! (`tests/capsules.rs`) share: a store on a real folder, the projection a capsule's
//! `EXPECT.json` records, the copy of a project as it leaves the app, and the lock.
//!
//! Included by path from both, since `tc-corpus`'s library may not depend on `tc-store`
//! (`crates/tc-arch`, "Dependency rules").

#![allow(
    dead_code,
    clippy::expect_used,
    clippy::unwrap_used,
    clippy::panic,
    reason = "generator and test support: a failed step stops the run, with the reason; not every binary uses each helper"
)]

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tc_journal::canon::{encode_key, encode_record_json};
use tc_journal::command::Command;
use tc_journal::fold::{FoldState, kind_name};
use tc_journal::record::VerseValue;
use tc_journal::{BookId, ChapterNo, FORMAT_MAJOR, FORMAT_MINOR, Record, RecordKey, VerseNo};
use tc_store::{
    FakePlatform, ManualClock, OpenOptions, ProjectHandle, Store, StoreConfig, StoreReply,
};

/// The nine capsules of a frozen version, in the order of `docs/STORAGE.md` §12.3.
pub const CAPSULES: [&str; 9] = [
    "bible-titus",
    "stories",
    "exchanged",
    "imported-tc4",
    "imported-usfm",
    "updated-book",
    "held-outside",
    "mixed-minor",
    "carried",
];

/// The capsule that holds changes of a newer minor.
pub const MIXED_MINOR: &str = "mixed-minor";

pub const LOCK: &str = "LOCK.sha256";
pub const EXPECT: &str = "EXPECT.json";
pub const PROJECT: &str = "project";

/// The wall time every store of a capsule run starts at (2026-10-17T00:00:00Z plus a day).
pub const CLOCK_MS: i64 = 1_792_195_200_000;

pub const TIT: BookId = BookId::Titus;

/// `<major>.<minor>` of this build.
pub fn this_version() -> String {
    format!("{FORMAT_MAJOR}.{FORMAT_MINOR}")
}

pub fn repo_root() -> PathBuf {
    tc_corpus::repo_root()
}

/// A store of one installation on a real folder: its app data and projects folder under
/// `root/<name>`, a fixed host name and a manual clock, so two runs differ only in what is
/// random by design (device and project ids).
pub struct Computer {
    pub store: Store,
    pub projects: PathBuf,
}

impl Computer {
    pub fn new(root: &Path, name: &str) -> Self {
        let projects = root.join(name).join("projects");
        std::fs::create_dir_all(&projects).unwrap();
        let store = Store::start(StoreConfig {
            app_data: root.join(name).join("app-data"),
            projects: projects.clone(),
            vfs: Arc::new(tc_store::StdFs),
            platform: Arc::new(FakePlatform {
                host: name.to_owned(),
                machine: format!("machine-of-{name}"),
                ..FakePlatform::default()
            }),
            clock: Arc::new(ManualClock::at(CLOCK_MS)),
            threads: 2,
            watch_debounce: std::time::Duration::from_millis(20),
        })
        .unwrap();
        store.wait_cleanup();
        // Every state the writer leaves is looked at as a Scripture Burrito; `problems`
        // reports what it found.
        store.hooks().check_burrito(|folder: &Path| {
            tc_burrito::validate_dir(folder)
                .into_iter()
                .map(|p| format!("{p:?}"))
                .collect()
        });
        Self { store, projects }
    }

    pub fn open(&self, folder: &Path) -> ProjectHandle {
        let handle = self
            .store
            .open(folder, &OpenOptions::default())
            .unwrap_or_else(|e| panic!("{}: {e}", folder.display()));
        handle.wait_idle();
        handle
    }

    /// The burrito problems the store's writer saw in any state it wrote.
    pub fn problems(&self) -> Vec<String> {
        self.store.hooks().burrito_problems()
    }
}

pub fn verse(c: u16, v: u16) -> RecordKey {
    RecordKey::Verse(TIT, ChapterNo::new(c).unwrap(), VerseNo::new(v).unwrap())
}

pub fn save_verse(handle: &ProjectHandle, c: u16, v: u16, words: &str) -> StoreReply {
    let shown = handle.mint(&verse(c, v), None).unwrap();
    handle
        .submit(Command::SaveVerse {
            shown,
            words: words.to_owned(),
        })
        .wait()
        .unwrap()
}

pub fn words(handle: &ProjectHandle, c: u16, v: u16) -> Option<String> {
    match handle.snapshot().fold().projected(&verse(c, v)) {
        Some(Record::Verse {
            value: VerseValue::Text { words, .. },
            ..
        }) => Some(words),
        _ => None,
    }
}

fn json_of(json: tc_journal::Json) -> serde_json::Value {
    serde_json::from_slice(&json.to_canonical()).unwrap()
}

/// The projection of a project as `EXPECT.json` records it: every record with at least one
/// change (its key, its projected value, its heads and its history), every conflict, every
/// carried placement and every anomaly, all in canonical forms the format itself defines
/// (keys and records as change lines encode them, ids as hex), so a build that reads the
/// same bytes gives the same document.
pub fn expectation(fold: &FoldState) -> serde_json::Value {
    let hex = |ids: &[tc_journal::ChangeId]| -> Vec<String> {
        ids.iter().map(|id| id.to_hex()).collect()
    };
    let key_json = |key: &RecordKey| json_of(encode_key(key).unwrap());
    let records: Vec<serde_json::Value> = fold
        .record_keys()
        .iter()
        .map(|key| {
            serde_json::json!({
                "key": key_json(key),
                "projected": fold.projected(key).map(|r| json_of(encode_record_json(&r).unwrap())),
                "heads": hex(&fold.heads(key)),
                "history": hex(&fold.history(key)),
            })
        })
        .collect();
    let conflicts: Vec<serde_json::Value> = fold
        .conflicts()
        .map(|c| {
            serde_json::json!({
                "id": c.id.to_hex(),
                "kind": kind_name(&c.kind),
                "key": key_json(&c.key),
                "alsoKeys": c.also_keys.iter().map(key_json).collect::<Vec<_>>(),
                "candidates": c.candidates.iter().map(|cand| serde_json::json!({
                    "head": cand.head.to_hex(),
                    "also": hex(&cand.also),
                    "device": cand.device.to_string(),
                    "at": cand.at.0,
                    "value": json_of(encode_record_json(&cand.value).unwrap()),
                })).collect::<Vec<_>>(),
                "provisional": c.provisional.to_hex(),
                "bases": hex(&c.bases),
            })
        })
        .collect();
    let carried: Vec<serde_json::Value> = fold
        .carried_files()
        .iter()
        .map(|p| {
            serde_json::json!({
                "path": p.path,
                "record": p.record.as_str(),
                "oid": p.oid.to_hex(),
                "size": p.size,
                "md5": p.md5.to_hex(),
                "head": p.head.to_hex(),
            })
        })
        .collect();
    let anomalies: Vec<String> = fold.anomalies().map(|a| format!("{a:?}")).collect();
    serde_json::json!({
        "format": { "major": FORMAT_MAJOR, "minor": FORMAT_MINOR },
        "records": records,
        "conflicts": conflicts,
        "carried": carried,
        "anomalies": anomalies,
    })
}

/// `EXPECT.json`'s bytes: pretty JSON with one trailing line feed.
pub fn expectation_bytes(value: &serde_json::Value) -> Vec<u8> {
    let mut bytes = serde_json::to_vec_pretty(value).unwrap();
    bytes.push(b'\n');
    bytes
}

/// Copies a project folder as it leaves the app (`docs/STORAGE.md` §12.3): every file but
/// `.git/` and `.tc/`, which are local to one computer.
pub fn copy_project(from: &Path, to: &Path) {
    copy_tree(from, to, &|name| name != ".git" && name != ".tc");
}

/// Copies every file under `from`, whole.
pub fn copy_tree(from: &Path, to: &Path, keep: &dyn Fn(&str) -> bool) {
    std::fs::create_dir_all(to).unwrap();
    for entry in std::fs::read_dir(from).unwrap() {
        let entry = entry.unwrap();
        let name = entry.file_name();
        if !keep(&name.to_string_lossy()) {
            continue;
        }
        let path = entry.path();
        if entry.file_type().unwrap().is_dir() {
            copy_tree(&path, &to.join(&name), keep);
        } else {
            std::fs::copy(&path, to.join(&name)).unwrap();
        }
    }
}

/// Every file under `root`, by its `/`-separated path relative to `root`, sorted.
pub fn files_under(root: &Path) -> BTreeMap<String, Vec<u8>> {
    fn walk(root: &Path, dir: &Path, out: &mut BTreeMap<String, Vec<u8>>) {
        for entry in std::fs::read_dir(dir).unwrap() {
            let entry = entry.unwrap();
            let path = entry.path();
            if entry.file_type().unwrap().is_dir() {
                walk(root, &path, out);
            } else {
                let rel = path
                    .strip_prefix(root)
                    .unwrap()
                    .to_string_lossy()
                    .replace('\\', "/");
                out.insert(rel, std::fs::read(&path).unwrap());
            }
        }
    }
    let mut out = BTreeMap::new();
    walk(root, root, &mut out);
    out
}

pub fn sha256_hex(bytes: &[u8]) -> String {
    use sha2::Digest as _;
    sha2::Sha256::digest(bytes)
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

/// `LOCK.sha256` for a capsule folder: `sha256sum` lines in binary form (`<hex> *<path>`) of
/// every file but the lock itself, paths relative to the capsule with `/` separators, sorted
/// by the bytes of the path.
pub fn lock_of(capsule: &Path) -> String {
    files_under(capsule)
        .iter()
        .filter(|(path, _)| path.as_str() != LOCK)
        .map(|(path, bytes)| format!("{} *{path}\n", sha256_hex(bytes)))
        .collect()
}
