//! New Bible from a Scripture Burrito (J9d, #845; STORAGE §10.2 R1–R2, §13, §13.2, §13.5).
//!
//! The picked `.zip` is opened under R1's caps, routed by what it is (work for Receive, a tC4
//! project with a journal, another flavor), validated, and read through STORAGE §13.2's seed,
//! whose check is §13's common one: every book byte for byte, every sidecar record field for
//! field and every non-derived `metadata.json` field (P9). Nothing is written until Create,
//! which reads the file again and makes the project in one write: the Burrito's records with the
//! fields the person changed, each book through `AddBookText` (aligned verses split out), and
//! the other files carried as they are.

use std::collections::BTreeMap;

use serde_json::Value;
use tc_api::create::{BurritoFound, Details};
use tc_api::refusal::CreateRefusal;
use tc_api::shown::Direction;
use tc_journal::keys::{MetaField, SettingKey};
use tc_journal::record::BookPresence;
use tc_journal::{BookId, Record, RecordKey};

use crate::backend::seed::{Tc4Folder, fixture_project_id, tc4_state_seed};

const METADATA: &str = "metadata.json";
const INGREDIENTS: &str = "ingredients/";
const DEFAULT_FONT: &str = "Noto Sans (default)";

/// A Burrito read and checked: what New Bible shows, and what Create writes.
#[derive(Debug, Clone)]
pub(crate) struct Burrito {
    pub found: BurritoFound,
    /// The Burrito's records but its books' text and its carried files: its metadata fields,
    /// versification, pins, settings, alignments and decisions.
    records: Vec<Record>,
    pub texts: Vec<tc_store::BookText>,
    pub carried: Vec<(String, Vec<u8>)>,
    /// The key of the first language's `name` the Language name field showed.
    language_locale: String,
}

fn unusable(reason: impl Into<String>) -> CreateRefusal {
    CreateRefusal::BurritoUnusable {
        reason: reason.into(),
    }
}

/// Opens, routes, validates and reads the Burrito in `bytes`, picked as `file_name`.
pub(crate) fn read(bytes: &[u8], file_name: &str) -> Result<Burrito, CreateRefusal> {
    let files = unzip(bytes)?;
    if files.contains_key("ingredients/tc/project.json") {
        return Err(CreateRefusal::BurritoForReceive);
    }
    if files
        .keys()
        .any(|path| path.starts_with("ingredients/checking/journal/"))
    {
        return Err(CreateRefusal::BurritoTc4);
    }
    let metadata = files.get(METADATA).ok_or_else(|| {
        unusable("The file has no metadata.json, so it is not a Scripture Burrito.")
    })?;
    // The flavor is named before validation: an audio Burrito is refused for what it is, not
    // for a rule of text Burritos it breaks.
    if let Ok(doc) = serde_json::from_slice::<Value>(metadata) {
        flavor(&doc)?;
    }
    let problems =
        tc_burrito::validate_project(metadata, &tc_burrito::MemProject::from(files.clone()));
    if !problems.is_empty() {
        let list: Vec<String> = problems.iter().map(ToString::to_string).collect();
        return Err(unusable(format!(
            "It is not a valid Scripture Burrito: {}.",
            list.join("; ")
        )));
    }
    let doc: Value = serde_json::from_slice(metadata)
        .map_err(|e| unusable(format!("metadata.json cannot be read: {e}")))?;
    let files = books_at_their_places(&doc, files)?;
    let name = file_name.strip_suffix(".zip").unwrap_or(file_name);
    let folder = Tc4Folder::from_files(name, files).map_err(|e| unusable(e.to_string()))?;
    let seed =
        tc4_state_seed(&folder, fixture_project_id(name)).map_err(|e| unusable(e.to_string()))?;

    let mut records = Vec::new();
    let mut texts = Vec::new();
    for record in seed
        .batches
        .iter()
        .flat_map(|batch| &batch.changes)
        .map(|change| &change.body().record)
    {
        match record {
            Record::BookPresence {
                book,
                value: BookPresence::Present { scope, .. },
            } => {
                let path = book_path(*book);
                let usfm = folder
                    .files()
                    .get(&path)
                    .and_then(|bytes| String::from_utf8(bytes.clone()).ok())
                    .ok_or_else(|| unusable(format!("{path} is not text")))?;
                texts.push(tc_store::BookText {
                    book: *book,
                    scope: scope.clone(),
                    usfm,
                    file_name: format!("{file_name}: {path}"),
                });
            }
            // The books come whole through `AddBookText`, and the store records the carried
            // files it finds on disk.
            Record::BookPresence { .. }
            | Record::BookHeader { .. }
            | Record::ChapterFront { .. }
            | Record::Verse { .. }
            | Record::BookLayout { .. }
            | Record::CarriedFile { .. } => {}
            other => records.push(other.clone()),
        }
    }
    let carried: Vec<(String, Vec<u8>)> = seed
        .fold
        .carried_files()
        .into_iter()
        .filter_map(|placement| {
            let bytes = seed.carried.get(&placement.oid)?.clone();
            Some((placement.path, bytes))
        })
        .collect();
    let own_versification = records
        .iter()
        .any(|record| matches!(record, Record::Versification { .. }));
    let guess = (!own_versification).then(|| {
        let shapes: Vec<_> = texts
            .iter()
            .filter_map(|text| {
                let parts = tc_usfm::codec::decompose(&text.usfm).ok()?;
                Some(crate::import::shape(text.book, &parts))
            })
            .collect();
        crate::import::scheme_guess(&shapes)
    });
    let found = BurritoFound {
        details: details(&doc, setting_text(&records, "textFont")),
        guess,
        books: texts.iter().map(|text| text.book).collect(),
        carried: carried.iter().map(|(path, _)| path.clone()).collect(),
    };
    let language_locale = shown_locale(&doc, &doc["languages"][0]["name"]);
    Ok(Burrito {
        found,
        records,
        texts,
        carried,
        language_locale,
    })
}

impl Burrito {
    /// The new project's first records: the Burrito's as written, and `base` (the records the
    /// dialog's fields make, `create::project_records`) for what the Burrito does not hold and
    /// for each field the person changed from what the Burrito filled in.
    pub(crate) fn records(&self, chosen: &Details, base: Vec<Record>) -> Vec<Record> {
        let shown = &self.found.details;
        let setting = |key: &str| SettingKey::parse(key).ok().map(RecordKey::Setting);
        let mut changed: Vec<RecordKey> = Vec::new();
        if chosen.name.trim() != shown.name.trim() {
            changed.push(RecordKey::ProjectMeta(MetaField::Name));
        }
        let name_changed = chosen.language_name.trim() != shown.language_name.trim();
        let code_changed = chosen.code.trim() != shown.code.trim();
        let direction_changed = chosen.direction != shown.direction;
        if direction_changed {
            changed.extend(setting("textDirection"));
        }
        if name_changed {
            changed.extend(setting("languageName"));
        }
        if code_changed || chosen.door43_code != shown.door43_code {
            changed.extend(setting("door43Language"));
        }
        if chosen.font != shown.font {
            changed.extend(setting("textFont"));
        }
        // The languages record holds what the form never shows (a second language, other
        // locales of the name, more properties): an edit changes only the edited parts of it.
        let languages = RecordKey::ProjectMeta(MetaField::Languages);
        let language_edited = name_changed || code_changed || direction_changed;
        let made = if language_edited {
            first_language(&base)
        } else {
            None
        };
        let edited_language = made.and_then(|made| {
            let own = self.records.iter().find(|record| record.key() == languages)?;
            let edits = [
                (name_changed, "name", made["name"]["en"].clone()),
                (code_changed, "tag", made["tag"].clone()),
                (direction_changed, "scriptDirection", made["scriptDirection"].clone()),
            ];
            with_language_edits(own, &self.language_locale, &edits)
        });
        if edited_language.is_none() && language_edited {
            changed.push(languages.clone());
        }
        let mut out: BTreeMap<RecordKey, Record> = base
            .into_iter()
            .map(|record| (record.key(), record))
            .collect();
        for record in &self.records {
            let key = record.key();
            if !changed.contains(&key) {
                out.insert(key, record.clone());
            }
        }
        if let Some(record) = edited_language {
            out.insert(languages, record);
        }
        out.into_values().collect()
    }
}

/// The first language of the languages record `create::project_records` made from the fields.
fn first_language(base: &[Record]) -> Option<Value> {
    base.iter().find_map(|record| match record {
        Record::ProjectMeta {
            field,
            value: Some(value),
        } if *field == MetaField::Languages => {
            serde_json::from_slice::<Value>(&value.to_canonical())
                .ok()?
                .get(0)
                .cloned()
        }
        _ => None,
    })
}

/// The Burrito's languages record `own` with each edited part of its first language set to
/// the value the fields made; the name is set in the locale the field showed. `None` when the
/// record is not a list whose first entry is an object.
fn with_language_edits(
    own: &Record,
    locale: &str,
    edits: &[(bool, &str, Value)],
) -> Option<Record> {
    let Record::ProjectMeta {
        field,
        value: Some(value),
    } = own
    else {
        return None;
    };
    let mut doc: Value = serde_json::from_slice(&value.to_canonical()).ok()?;
    let first = doc.get_mut(0)?.as_object_mut()?;
    for (edited, part, made) in edits {
        if !edited || made.is_null() {
            continue;
        }
        if *part == "name" {
            let names = first
                .entry("name")
                .or_insert_with(|| Value::Object(serde_json::Map::new()));
            names.as_object_mut()?.insert(locale.to_owned(), made.clone());
        } else {
            first.insert((*part).to_owned(), made.clone());
        }
    }
    let value = tc_journal::json::parse(doc.to_string().as_bytes()).ok()?;
    Some(Record::ProjectMeta {
        field: field.clone(),
        value: Some(value),
    })
}

/// The key of a localized `value` that [`details`] reads: the Burrito's own locale, else
/// English, else the first; English when there is none.
fn shown_locale(doc: &Value, value: &Value) -> String {
    let locale = doc["meta"]["defaultLocale"].as_str().unwrap_or("en");
    let Some(names) = value.as_object() else {
        return "en".to_owned();
    };
    [locale, "en"]
        .into_iter()
        .find(|key| names.contains_key(*key))
        .map(str::to_owned)
        .or_else(|| names.keys().next().cloned())
        .unwrap_or_else(|| "en".to_owned())
}

/// The file entries of the zip under R1's rules, by path. A zip of the Burrito's folder (what a
/// file manager makes) holds it under one top-level folder, which is taken off.
fn unzip(bytes: &[u8]) -> Result<BTreeMap<String, Vec<u8>>, CreateRefusal> {
    let damaged = || unusable("This file is damaged. Ask for a new copy.");
    let entries = tc_burrito::read_zip(std::io::Cursor::new(bytes), tc_burrito::ZIP_LIMITS)
        .map_err(|e| match e {
            tc_burrito::ZipReadError::NotAZip(_) | tc_burrito::ZipReadError::RepeatedName => {
                damaged()
            }
            too_large => unusable(format!("The file cannot be opened: {too_large}.")),
        })?;
    let mut files = BTreeMap::new();
    for entry in entries {
        let symlink = entry.unix_mode.is_some_and(|m| m & 0o170_000 == 0o120_000);
        if !entry.enclosed || symlink {
            return Err(unusable(format!(
                "The file holds {:?}, which is not a file inside the Burrito.",
                entry.name
            )));
        }
        let bytes = entry.bytes.map_err(|_| damaged())?;
        files.insert(entry.name, bytes);
    }
    if files.contains_key(METADATA) {
        return Ok(files);
    }
    let top = files.keys().find_map(|name| {
        let folder = name.strip_suffix("/metadata.json")?;
        (!folder.contains('/')).then(|| format!("{folder}/"))
    });
    Ok(match top {
        Some(top) => files
            .into_iter()
            .filter_map(|(name, bytes)| Some((name.strip_prefix(&top)?.to_owned(), bytes)))
            .collect(),
        None => files,
    })
}

/// A Bible translation, or the refusal naming the flavor (`name/flavor`).
fn flavor(doc: &Value) -> Result<(), CreateRefusal> {
    let flavor_type = &doc["type"]["flavorType"];
    let (name, flavor) = (
        flavor_type["name"].as_str().unwrap_or(""),
        flavor_type["flavor"]["name"].as_str().unwrap_or(""),
    );
    if (name, flavor) == ("scripture", "textTranslation") || (name.is_empty() && flavor.is_empty())
    {
        // A document with no flavor is the validator's to refuse, in its words.
        return Ok(());
    }
    Err(CreateRefusal::BurritoFlavor {
        flavor: format!("{name}/{flavor}"),
    })
}

/// Where a project keeps a book's text.
fn book_path(book: BookId) -> String {
    format!("{INGREDIENTS}{}.usfm", book.code())
}

/// Each USFM ingredient of one book moved to the place the project keeps that book: another
/// tool may name it `ingredients/01-GEN.SFM`. Its bytes do not change. An ingredient outside
/// `ingredients/` is refused, since the project could not keep it.
fn books_at_their_places(
    doc: &Value,
    mut files: BTreeMap<String, Vec<u8>>,
) -> Result<BTreeMap<String, Vec<u8>>, CreateRefusal> {
    let Some(Value::Object(ingredients)) = doc.get("ingredients") else {
        return Ok(files);
    };
    for (path, entry) in ingredients {
        if !path.starts_with(INGREDIENTS) {
            return Err(unusable(format!(
                "{path} is outside the ingredients folder, so the project could not keep it."
            )));
        }
        let lower = path.to_ascii_lowercase();
        let usfm = entry["mimeType"] == "text/x-usfm"
            || lower.ends_with(".usfm")
            || lower.ends_with(".sfm");
        let book = entry["scope"]
            .as_object()
            .filter(|scope| scope.len() == 1)
            .and_then(|scope| scope.keys().next())
            .and_then(|code| code.parse::<BookId>().ok());
        let (true, Some(book)) = (usfm, book) else {
            continue;
        };
        let place = book_path(book);
        if *path == place || files.contains_key(&place) {
            continue;
        }
        if let Some(bytes) = files.remove(path) {
            files.insert(place, bytes);
        }
    }
    Ok(files)
}

/// The fields as `metadata.json` fills them: the name and the first language in the
/// Burrito's own locale (else English, else the first), the language's tag and direction.
fn details(doc: &Value, font: Option<String>) -> Details {
    let locale = doc["meta"]["defaultLocale"].as_str().unwrap_or("en");
    let localized = |value: &Value| {
        value
            .get(locale)
            .or_else(|| value.get("en"))
            .or_else(|| value.as_object()?.values().next())
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_owned()
    };
    let language = &doc["languages"][0];
    Details {
        name: localized(&doc["identification"]["name"]),
        language_name: localized(&language["name"]),
        code: language["tag"].as_str().unwrap_or_default().to_owned(),
        door43_code: None,
        direction: if language["scriptDirection"] == "rtl" {
            Direction::Rtl
        } else {
            Direction::Ltr
        },
        font: font.unwrap_or_else(|| DEFAULT_FONT.to_owned()),
    }
}

/// A setting the Burrito's `settings.json` holds as text.
fn setting_text(records: &[Record], name: &str) -> Option<String> {
    let key = SettingKey::parse(name).ok()?;
    records.iter().find_map(|record| match record {
        Record::Setting {
            key: found,
            value: Some(value),
        } if *found == key => serde_json::from_slice::<Value>(&value.to_canonical())
            .ok()?
            .as_str()
            .map(str::to_owned),
        _ => None,
    })
}
