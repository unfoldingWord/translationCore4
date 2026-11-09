//! The prerequisite for sending a committed project to Door43 or an exchange file.

use tc_store::{CheckpointReport, CheckpointSkip};

/// A skipped checkpoint leaves local work safe, but only NoChanges proves that the
/// existing commit already holds the captured work.
pub(crate) fn require_committed(report: &CheckpointReport) -> Result<(), CheckpointSkip> {
    match report.skipped {
        None | Some(CheckpointSkip::NoChanges) => Ok(()),
        Some(
            why @ (CheckpointSkip::ReadOnly
            | CheckpointSkip::SecondWriter
            | CheckpointSkip::NoHistory
            | CheckpointSkip::SealFailed
            | CheckpointSkip::PackMissing
            | CheckpointSkip::TreeInvalid
            | CheckpointSkip::HeadMoved),
        ) => Err(why),
    }
}

/// The reason reaches the screen inside the sync or exchange refusal's sentence.
pub(crate) fn skip_words(why: CheckpointSkip) -> String {
    match why {
        CheckpointSkip::NoChanges => "nothing changed since the last checkpoint",
        CheckpointSkip::ReadOnly => "the project is read-only",
        CheckpointSkip::SecondWriter => "another translationCore is saving into this project",
        CheckpointSkip::NoHistory => "the project has no local history",
        CheckpointSkip::SealFailed => "the latest saves could not be prepared for history",
        CheckpointSkip::PackMissing => "a saved change file is missing or unreadable",
        CheckpointSkip::TreeInvalid => {
            "the project could not be recorded as a valid Scripture Burrito"
        }
        CheckpointSkip::HeadMoved => {
            "the project history changed before the checkpoint finished; try again"
        }
    }
    .to_owned()
}
