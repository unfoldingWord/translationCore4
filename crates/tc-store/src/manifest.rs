//! `.tc/materialized.json`, the manifest (`docs/STORAGE.md` §3.6, §6.2): what the app last
//! wrote at each derived or carried path, and the md5 each pack is listed with in
//! `metadata.json`. An open tests each path against its entry before it reads the file.
//!
//! Each path's entry is the placement ledger's record of it (`crate::ledger`): who wrote the
//! bytes there. `.tc/heads/<escaped path>.bin` holds the heads each placement it names stands
//! for.

use crate::ledger::{Held, Placement, State};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use tc_journal::format::DERIVATIONS_V0;
use tc_journal::{ChangeId, FORMAT_MINOR, RecordKey};

/// The ledger's record of a path (§6.2): its [`State`], and what the app keeps about the bytes
/// it placed there.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    #[serde(flatten)]
    pub state: State,
    /// The scope digest the bytes were projected from.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scope: Option<String>,
    /// A carried file's git blob id.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub oid: Option<String>,
    /// For a USFM or story file: whether the bytes are in NFC, so `metadata.json` says
    /// `normalization` without projecting every book again (§3.4).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub nfc: Option<bool>,
    /// The git blob that holds exactly these bytes, once a checkpoint has stored it (§9.4).
    /// A new entry has none: a changed file is stored at the next checkpoint.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub blob: Option<String>,
    /// The path the disk holds a carried file at, when the disk spells it otherwise than the
    /// project does (§3.3): a disk that ignores letter case keeps `Audio/Intro.mp3` inside an
    /// existing `audio/`. `metadata.json` in the folder lists the file there.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub spelled: Option<String>,
}

impl Entry {
    pub fn new(state: State) -> Self {
        Self {
            state,
            scope: None,
            oid: None,
            nfc: None,
            blob: None,
            spelled: None,
        }
    }

    /// An entry for bytes the app has just placed or found its own.
    pub fn placed(md5: String, size: u64, mtime_ns: Option<i64>, settled: bool) -> Self {
        Self::new(State::Placed {
            placed: Placement {
                md5,
                size,
                mtime_ns,
                settled,
            },
        })
    }

    /// The bytes the app placed there and knows to be there.
    pub fn placement(&self) -> Option<&Placement> {
        match &self.state {
            State::Placed { placed } => Some(placed),
            _ => None,
        }
    }

    /// The md5 of the bytes the app placed there and knows to be there.
    pub fn md5(&self) -> Option<&str> {
        self.placement().map(|p| p.md5.as_str())
    }

    pub fn held(&self) -> Option<&Held> {
        match &self.state {
            State::Held { held } => Some(held),
            _ => None,
        }
    }

    /// What the ledger says the folder holds there: the bytes placed or held, with their size.
    /// `None` while a write is under way or nothing is known.
    pub fn listed(&self) -> Option<(&str, u64)> {
        match &self.state {
            State::Placed { placed } => Some((&placed.md5, placed.size)),
            State::Held { held } => Some((&held.md5, held.size)),
            State::Writing { .. } | State::Unknown => None,
        }
    }
}

/// What `metadata.json` lists for a pack.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PackEntry {
    pub md5: String,
    pub size: u64,
    /// The 64-bit fingerprint (§2.6) the md5 was computed for, as 16 hex digits: an open
    /// fingerprints every pack anyway (O8), so a pack listed here is never hashed again.
    pub fingerprint: String,
    /// The git blob that holds the pack's bytes, once stored (§4.4, §5.11 K3).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub blob: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Manifest {
    pub minor: u16,
    pub derivations: BTreeMap<String, u64>,
    pub paths: BTreeMap<String, Entry>,
    pub packs: BTreeMap<String, PackEntry>,
    /// One entry for each kept copy of a file changed outside the app that still has a
    /// notice, until it is imported or dismissed (delta §2.3).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub kept: Vec<crate::kept::Kept>,
}

impl Default for Manifest {
    fn default() -> Self {
        Self {
            minor: FORMAT_MINOR,
            derivations: current_derivations(),
            paths: BTreeMap::new(),
            packs: BTreeMap::new(),
            kept: Vec::new(),
        }
    }
}

pub fn current_derivations() -> BTreeMap<String, u64> {
    DERIVATIONS_V0
        .iter()
        .map(|(name, v)| ((*name).to_owned(), *v))
        .collect()
}

impl Manifest {
    /// Reads the manifest; `None` when it is missing or unreadable (every path is then
    /// read and classified as having no entry, §6.2).
    pub fn parse(bytes: &[u8]) -> Option<Self> {
        serde_json::from_slice(bytes).ok()
    }

    pub fn to_bytes(&self) -> Vec<u8> {
        serde_json::to_vec(self).unwrap_or_default()
    }

    /// The carried paths whose file the disk holds under another spelling, by that spelling.
    pub fn disk_names(&self) -> BTreeMap<String, String> {
        self.paths
            .iter()
            .filter_map(|(path, entry)| Some((entry.spelled.clone()?, path.clone())))
            .collect()
    }

    /// The projection versions in the manifest are this app's.
    pub fn versions_current(&self) -> bool {
        self.minor == FORMAT_MINOR && self.derivations == current_derivations()
    }
}

/// A heads file (§3.6): for each placement the ledger names at a path, by the md5 of its bytes,
/// the heads of every record the bytes were built from by the token rule (§2.7) and, for a
/// book's USFM, a digest of how the bytes show each record (§11.1 X3, D10), so reconciling an
/// outside edit looks at the records whose digest changed and no others. It is written before
/// the ledger names the bytes (§5.10 M3), so a placement the ledger names always has its heads
/// here. Postcard behind a magic prefix.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct HeadsFile {
    pub placements: Vec<PlacedHeads>,
}

/// The heads of one placement.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PlacedHeads {
    pub md5: String,
    pub records: Vec<HeadsRecord>,
}

/// One record of a placement.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct HeadsRecord {
    /// The record's canonical key.
    pub key: String,
    pub heads: Vec<[u8; 32]>,
    /// How the written file showed the record, when the file kind keeps digests.
    pub shown: Option<[u8; 16]>,
}

/// Marks a heads file keyed by placement.
const HEADS_MAGIC: &[u8; 4] = b"TCH\x03";

/// The records of a heads file for the heads a file was built from and its digests.
pub fn heads_records(
    heads: &[(RecordKey, Vec<ChangeId>)],
    digests: &[(RecordKey, tc_journal::outside::ShownDigest)],
) -> Vec<HeadsRecord> {
    let shown: std::collections::HashMap<&RecordKey, &[u8; 16]> =
        digests.iter().map(|(k, d)| (k, d)).collect();
    heads
        .iter()
        .map(|(key, ids)| HeadsRecord {
            key: key_text(key),
            heads: ids.iter().map(|id| *id.as_bytes()).collect(),
            shown: shown.get(key).map(|d| **d),
        })
        .collect()
}

/// A record key as a heads file names it.
pub fn key_text(key: &RecordKey) -> String {
    tc_journal::canon::encode_key(key)
        .map(|j| j.to_canonical_string())
        .unwrap_or_default()
}

impl HeadsFile {
    /// The heads of the placement of bytes `md5`.
    pub fn get(&self, md5: &str) -> Option<&[HeadsRecord]> {
        self.placements
            .iter()
            .find(|p| p.md5 == md5)
            .map(|p| p.records.as_slice())
    }

    /// This file with the heads of `md5` set, keeping only the placements `keep` names.
    pub fn with(mut self, md5: &str, records: Vec<HeadsRecord>, keep: &[&str]) -> Self {
        self.placements
            .retain(|p| p.md5 != md5 && keep.contains(&p.md5.as_str()));
        self.placements.push(PlacedHeads {
            md5: md5.to_owned(),
            records,
        });
        self
    }

    pub fn to_bytes(&self) -> Vec<u8> {
        let mut out = HEADS_MAGIC.to_vec();
        out.extend(postcard::to_allocvec(&self.placements).unwrap_or_default());
        out
    }

    /// The heads file in `bytes`; `None` when it is not one (a file of an earlier format names
    /// no placement, so the ledger keeps no heads for it).
    pub fn parse(bytes: &[u8]) -> Option<Self> {
        let rest = bytes.strip_prefix(HEADS_MAGIC.as_slice())?;
        let placements = postcard::from_bytes(rest).ok()?;
        Some(Self { placements })
    }
}

#[cfg(test)]
#[allow(
    clippy::unwrap_used,
    reason = "test code: a failed unwrap is a failed test"
)]
mod tests {
    use super::*;

    fn ledger_with(entry: Entry) -> Manifest {
        let mut manifest = Manifest::default();
        manifest
            .paths
            .insert("ingredients/Audio/Intro.mp3".into(), entry);
        manifest
    }

    /// `.tc/materialized.json` is outside the format (STORAGE §12.3), so a build reads the
    /// ledger another build wrote: a field it does not know is passed over, never a reason to
    /// drop the ledger.
    #[test]
    fn a_ledger_with_a_field_this_build_does_not_know_still_parses() {
        let manifest = ledger_with(Entry::placed(
            "d41d8cd98f00b204e9800998ecf8427e".into(),
            0,
            None,
            true,
        ));
        let mut doc: serde_json::Value = serde_json::from_slice(&manifest.to_bytes()).unwrap();
        doc["paths"]["ingredients/Audio/Intro.mp3"]["aLaterBuildsField"] = "x".into();
        doc["aLaterBuildsField"] = 1.into();
        let read = Manifest::parse(&serde_json::to_vec(&doc).unwrap()).unwrap();
        assert_eq!(read, manifest);
    }

    /// §3.3: the disk's spelling is kept only where it differs, so the ledger of a project
    /// with no such file has the bytes it had before the field existed.
    #[test]
    fn the_disk_spelling_is_written_only_where_it_differs() {
        let mut entry = Entry::placed("d41d8cd98f00b204e9800998ecf8427e".into(), 0, None, true);
        let plain = ledger_with(entry.clone());
        assert!(
            !String::from_utf8(plain.to_bytes())
                .unwrap()
                .contains("spelled")
        );
        assert!(plain.disk_names().is_empty());

        entry.spelled = Some("ingredients/audio/Intro.mp3".into());
        let spelled = ledger_with(entry);
        assert_eq!(Manifest::parse(&spelled.to_bytes()).unwrap(), spelled);
        assert_eq!(
            spelled.disk_names(),
            BTreeMap::from([(
                "ingredients/audio/Intro.mp3".to_owned(),
                "ingredients/Audio/Intro.mp3".to_owned()
            )])
        );
    }
}
