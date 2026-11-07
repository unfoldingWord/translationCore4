//! J9d (#845): a new Bible project from a Scripture Burrito, through `App::request` on tc-store
//! over its in-memory file system. The Burrito is read and checked before anything is written;
//! Create makes the project, its books, sidecars, metadata and other files in one write.

use std::collections::BTreeMap;
use std::io::Write;
use std::path::Path;
use std::sync::Arc;

use serde_json::{Value, json};
use tc_api::ApiError;
use tc_api::Refusal;
use tc_api::create::{Bible, BurritoFound, Details, ReadBurrito};
use tc_api::event::CheckpointOutcome;
use tc_api::home::List;
use tc_api::ids::{ProjectRef, UploadId};
use tc_api::refusal::CreateRefusal;
use tc_api::shown::Direction;
use tc_app::StoreChoice;
use tc_core::BookId;
use tc_journal::{Json, RecordKey};

use super::common::{Parts, TestApp, post, rid};
use crate::counting_store::{CountingStore, SharedStore};
use crate::store_world::{StoreWorld, assert_valid_burrito, files, store_world};

const SAMPLE: &str = "../../fixtures/tc4/sample-burrito";

async fn app() -> (tempfile::TempDir, TestApp, StoreWorld) {
    let world = store_world();
    let store = Arc::new(CountingStore::new(SharedStore(world.store())));
    let dir = tempfile::tempdir().unwrap();
    std::fs::create_dir_all(dir.path().join("app-data/uploads")).unwrap();
    let t = TestApp::start_with(dir.path(), &Parts::new(), |_, deps| {
        deps.store = StoreChoice::Given(store.clone());
    })
    .await;
    (dir, t, world)
}

/// The sample Burrito's files (tC4 shape: books, sidecars, `vrs.json`), by path.
fn sample() -> BTreeMap<String, Vec<u8>> {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join(SAMPLE);
    let mut out = BTreeMap::new();
    let mut dirs = vec![root.clone()];
    while let Some(dir) = dirs.pop() {
        for entry in std::fs::read_dir(dir).unwrap() {
            let path = entry.unwrap().path();
            if path.is_dir() {
                dirs.push(path);
            } else {
                let rel = path.strip_prefix(&root).unwrap().to_string_lossy();
                out.insert(rel.replace('\\', "/"), std::fs::read(&path).unwrap());
            }
        }
    }
    out
}

fn metadata_of(files: &BTreeMap<String, Vec<u8>>) -> Value {
    serde_json::from_slice(&files["metadata.json"]).unwrap()
}

/// Adds `path` to the Burrito and to its ingredient list, or takes it out of both.
fn set_file(files: &mut BTreeMap<String, Vec<u8>>, path: &str, bytes: Option<&[u8]>) {
    let mut meta = metadata_of(files);
    match bytes {
        Some(bytes) => {
            files.insert(path.to_owned(), bytes.to_vec());
            let facts = tc_burrito::FileFacts::of(bytes);
            meta["ingredients"][path] = json!({
                "checksum": { "md5": facts.md5.to_string() },
                "mimeType": "text/markdown",
                "size": facts.size,
            });
        }
        None => {
            files.remove(path);
            meta["ingredients"].as_object_mut().unwrap().remove(path);
        }
    }
    files.insert(
        "metadata.json".to_owned(),
        serde_json::to_vec_pretty(&meta).unwrap(),
    );
}

fn zip(files: &BTreeMap<String, Vec<u8>>) -> Vec<u8> {
    let mut writer = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
    for (name, bytes) in files {
        writer
            .start_file(name.as_str(), zip::write::SimpleFileOptions::default())
            .unwrap();
        writer.write_all(bytes).unwrap();
    }
    writer.finish().unwrap().into_inner()
}

/// Puts a file where the server's upload route would have stored it.
fn upload(dir: &Path, n: u8, bytes: &[u8]) -> UploadId {
    let id = UploadId::parse(&format!("{n:032x}")).unwrap();
    std::fs::write(dir.join("app-data/uploads").join(id.as_str()), bytes).unwrap();
    id
}

fn uploaded(dir: &Path, id: &UploadId) -> bool {
    dir.join("app-data/uploads").join(id.as_str()).exists()
}

fn create(n: u8, details: Details, burrito: UploadId) -> Bible {
    Bible {
        request: rid(n),
        details,
        versification: "eng".to_owned(),
        files: Vec::new(),
        burrito: Some(burrito),
    }
}

async fn listed(t: &TestApp) -> Vec<ProjectRef> {
    post(&t.app, &List {})
        .await
        .unwrap()
        .cards
        .into_iter()
        .map(|card| card.project)
        .collect()
}

async fn read(t: &TestApp, upload: &UploadId) -> Result<BurritoFound, ApiError> {
    post(
        &t.app,
        &ReadBurrito {
            upload: upload.clone(),
        },
    )
    .await
}

fn refused(error: ApiError) -> CreateRefusal {
    match error {
        ApiError::Refused(Refusal::Create(refusal)) => refusal,
        other => panic!("{other:?}"),
    }
}

/// The non-derived fields of `metadata.json` that P9 compares, by dotted path.
/// What the fields do not decide (`burrito::from_the_fields`), kept as written.
const KEPT: &[&str] = &[
    "identification.description",
    "identification.abbreviation",
    "copyright",
    "confidential",
    "localizedNames",
    "meta.dateCreated",
    "meta.defaultLocale",
];

fn at<'a>(doc: &'a Value, path: &str) -> &'a Value {
    path.split('.').fold(doc, |value, part| &value[part])
}

/// J9d: the Burrito is read before anything is written, and fills the fields; its own
/// versification offers no choice. Create makes the project with every book byte for byte,
/// the alignments and decisions, `vrs.json` byte for byte, every non-derived metadata field as
/// written (P9) and the other files carried, in one write: a valid Scripture Burrito.
#[tokio::test]
async fn a_bible_from_a_burrito_keeps_its_books_sidecars_metadata_and_files() {
    let (dir, t, world) = app().await;
    let mut source = sample();
    let license = b"# License\n\nCC BY-SA 4.0\n";
    set_file(&mut source, "ingredients/LICENSE.md", Some(license));
    let id = upload(dir.path(), 1, &zip(&source));
    let before = listed(&t).await;

    let found = read(&t, &id).await.unwrap();
    assert_eq!(
        found.details,
        Details {
            name: "Equipo Ejemplo — Tito y Jonás".to_owned(),
            language_name: "Spanish (Latin America)".to_owned(),
            code: "es-419".to_owned(),
            door43_code: None,
            direction: Direction::Ltr,
            font: "Noto Sans (default)".to_owned(),
        }
    );
    assert_eq!(found.guess, None, "the Burrito's own versification is kept");
    assert_eq!(found.books, [BookId::Jonah, BookId::Titus]);
    assert_eq!(found.carried, ["ingredients/LICENSE.md"]);
    assert_eq!(listed(&t).await, before, "reading writes nothing");
    assert!(uploaded(dir.path(), &id), "the file stays for Create");

    let created = post(&t.app, &create(1, found.details.clone(), id.clone()))
        .await
        .unwrap();
    let folder = world.folder(&created.project);
    let on_disk = files(&world.fs, &folder);
    for path in [
        "ingredients/TIT.usfm",
        "ingredients/JON.usfm",
        "ingredients/vrs.json",
        "ingredients/LICENSE.md",
    ] {
        assert_eq!(on_disk[path], source[path], "{path} byte for byte");
    }
    for path in [
        "ingredients/checking/alignments/TIT.json",
        "ingredients/checking/translationWords/TIT.json",
        "ingredients/checking/translationNotes/TIT.json",
    ] {
        assert!(on_disk.contains_key(path), "{path} is kept");
    }
    let made = metadata_of(&on_disk);
    let given = metadata_of(&source);
    for path in KEPT {
        assert_eq!(at(&made, path), at(&given, path), "{path} as written (P9)");
    }
    assert_eq!(
        made["identification"]["name"],
        json!({ "en": "Equipo Ejemplo — Tito y Jonás" })
    );
    assert_eq!(
        made["languages"],
        json!([{ "name": { "en": "Spanish (Latin America)" }, "scriptDirection": "ltr", "tag": "es-419" }]),
        "the language is the fields', as for USFM files"
    );
    assert_valid_burrito(&world.fs, &folder);
    assert!(
        !uploaded(dir.path(), &id),
        "the Burrito's upload is deleted"
    );
}

/// J9d: the fields decide the name, language and direction, as for USFM files; every other
/// field stays as the Burrito wrote it.
#[tokio::test]
async fn a_changed_field_is_written_and_the_rest_as_the_burrito_has_it() {
    let (dir, t, world) = app().await;
    let source = sample();
    let id = upload(dir.path(), 1, &zip(&source));
    let found = read(&t, &id).await.unwrap();
    let chosen = Details {
        name: "Equipo Tito".to_owned(),
        direction: Direction::Rtl,
        ..found.details.clone()
    };
    let created = post(&t.app, &create(1, chosen, id)).await.unwrap();
    assert_eq!(created.project.as_str(), "equipo_tito");
    let made = metadata_of(&files(&world.fs, &world.folder(&created.project)));
    let given = metadata_of(&source);
    assert_eq!(
        made["identification"]["name"],
        json!({ "en": "Equipo Tito" })
    );
    assert_eq!(made["languages"][0]["scriptDirection"], "rtl");
    for path in [
        "identification.description",
        "copyright",
        "meta.dateCreated",
    ] {
        assert_eq!(at(&made, path), at(&given, path), "{path} as written");
    }
}

/// J9d, tC4 #813 and #823: a Burrito with no `vrs.json` offers the versification its books
/// fit, imports with it, and the project can be saved and checkpointed afterwards.
#[tokio::test]
async fn a_burrito_with_no_versification_imports_and_saves_and_checkpoints() {
    let (dir, t, world) = app().await;
    let mut source = sample();
    set_file(&mut source, "ingredients/vrs.json", None);
    let id = upload(dir.path(), 1, &zip(&source));
    let found = read(&t, &id).await.unwrap();
    let guess = found
        .guess
        .clone()
        .expect("a guess when the Burrito has none");
    assert_eq!(guess.scheme, "eng");
    let created = post(&t.app, &create(1, found.details, id)).await.unwrap();
    let handle = world.open(&created.project);
    let key = RecordKey::Setting(tc_journal::keys::SettingKey::parse("textFont").unwrap());
    handle
        .submit(tc_app::backend::StoreCommand::set_setting(
            handle.snapshot().mint(&key, None).unwrap(),
            Some(Json::Str("Charis SIL".to_owned())),
        ))
        .await
        .unwrap();
    let outcome = handle
        .checkpoint(tc_app::backend::CheckpointReason::Other("test".into()))
        .await;
    assert!(
        matches!(outcome, CheckpointOutcome::Committed),
        "{outcome:?}"
    );
    handle.clone().close().await.unwrap();
    assert_valid_burrito(&world.fs, &world.folder(&created.project));
}

/// What a refused case must be refused as.
type Expected = fn(&CreateRefusal) -> bool;

/// J9d: what is not a Bible Burrito to start a project from is refused in words, before
/// anything is written: work for Receive, a tC4 project with a journal, another flavor, a
/// damaged file, a Burrito that is not valid, and a metadata value a Burrito cannot hold
/// (STORAGE §3.4 "build_metadata is total"). Create with such a file makes nothing either.
#[tokio::test]
async fn what_is_not_a_bible_burrito_is_refused_in_words_and_nothing_is_written() {
    let (dir, t, world) = app().await;
    let before = listed(&t).await;
    let mut exchange = sample();
    exchange.insert("ingredients/tc/project.json".to_owned(), b"{}".to_vec());
    let mut tc4 = sample();
    tc4.insert(
        "ingredients/checking/journal/0001.json".to_owned(),
        b"{}".to_vec(),
    );
    let mut obs = sample();
    let mut meta = metadata_of(&obs);
    meta["type"]["flavorType"] = json!({ "name": "gloss", "flavor": { "name": "textStories" } });
    obs.insert("metadata.json".to_owned(), meta.to_string().into_bytes());
    let mut not_valid = sample();
    not_valid.insert("ingredients/TIT.usfm".to_owned(), b"\\id TIT\n".to_vec());
    let mut trailing = sample();
    let mut meta = metadata_of(&trailing);
    meta["identification"]["name"]["en"] = json!("Equipo Ejemplo ");
    trailing.insert("metadata.json".to_owned(), meta.to_string().into_bytes());

    let cases: Vec<(Vec<u8>, Expected)> = vec![
        (zip(&exchange), |r| {
            matches!(r, CreateRefusal::BurritoForReceive)
        }),
        (zip(&tc4), |r| matches!(r, CreateRefusal::BurritoTc4)),
        (
            zip(&obs),
            |r| matches!(r, CreateRefusal::BurritoFlavor { flavor } if flavor == "gloss/textStories"),
        ),
        (
            b"PK\x03\x04 not a zip".to_vec(),
            |r| matches!(r, CreateRefusal::BurritoUnusable { reason } if reason.contains("damaged")),
        ),
        (
            zip(&not_valid),
            |r| matches!(r, CreateRefusal::BurritoUnusable { reason } if reason.contains("md5")),
        ),
        (
            zip(&trailing),
            |r| matches!(r, CreateRefusal::BurritoUnusable { reason } if reason.contains("/identification/name/en")),
        ),
    ];
    for (n, (bytes, expected)) in (1u8..).zip(cases) {
        let id = upload(dir.path(), n, &bytes);
        let refusal = refused(read(&t, &id).await.unwrap_err());
        assert!(expected(&refusal), "case {n}: {refusal:?}");
        let details = Details {
            name: format!("Refused {n}"),
            language_name: "Español".to_owned(),
            code: "es-419".to_owned(),
            door43_code: None,
            direction: Direction::Ltr,
            font: "Noto Sans (default)".to_owned(),
        };
        let error = post(&t.app, &create(n, details, id.clone()))
            .await
            .unwrap_err();
        assert!(expected(&refused(error)), "case {n}: Create refuses too");
        assert!(
            uploaded(dir.path(), &id),
            "case {n}: the file is given back"
        );
    }
    assert_eq!(listed(&t).await, before, "nothing was made");
    assert!(
        world
            .fs
            .files_under(&world.folder(&ProjectRef::parse("refused_1").unwrap()))
            .is_empty()
    );
}
