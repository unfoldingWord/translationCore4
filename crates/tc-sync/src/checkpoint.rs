//! The prerequisite for sending a committed project to Door43 or an exchange file.

use tc_store::{CheckpointReason, CheckpointReport, CheckpointSkip, ProjectHandle, StoreError};

/// How many times a checkpoint whose history moved under it is taken.
const TRIES: u8 = 3;

/// Takes the checkpoint a sync or an export stands on. One that finds the history moved lost
/// a race with another checkpoint (the one a save makes when a person leaves the book) or
/// with another program: the project is sound, so it is taken again on the new history and
/// not reported as a failure. What is sent is still a checkpoint this app made (#961); a
/// history that moves under every try is the failure.
pub(crate) async fn committed(
    project: &ProjectHandle,
    reason: CheckpointReason,
) -> Result<Result<(), CheckpointSkip>, StoreError> {
    let mut left = TRIES;
    loop {
        let report = project.checkpoint(reason.clone()).await?;
        left -= 1;
        match require_committed(&report) {
            Err(CheckpointSkip::HeadMoved) if left > 0 => {}
            outcome => return Ok(outcome),
        }
    }
}

/// A skipped checkpoint leaves local work safe, but only NoChanges proves that the
/// existing commit already holds the captured work.
fn require_committed(report: &CheckpointReport) -> Result<(), CheckpointSkip> {
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
