//! Downloading the versions a project pins and this computer lacks (#1013; owner rulings of
//! 2026-11-12: the download asks no question, and at an open from Door43 a cancel or a failed
//! download adds no project).
//!
//! The download is a state machine: one pinned version at a time, in the order
//! `tc_resources::resolve::missing_versions` gives, and it ends `Ok` only after every one of
//! them was installed. Each install is `install_dcs_watched`, the one download
//! of a pinned version: it checks the download against the pinned commit and installs whole
//! or not at all, so a version that finished before a cancel or a failure stays, and nothing
//! of the one that did not finish is kept.

use tc_api::jobs::Phase;
use tc_api::refusal::PinFailure;
use tc_api::resources::PinLabel;
use tc_door43::Door43Error;
use tc_resources::{InstallError, Packaging, ProjectPins, ResourcePin, install_dcs_watched};

use crate::app::App;
use crate::jobs::JobCtx;
use crate::resources::JobWatch;

/// Why the download of a project's missing pins ended before every version was here.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PinsStop {
    /// The person cancelled.
    Cancelled,
    /// The internet was turned off before a version was asked for.
    Offline,
    /// `pin` was not installed. `why` is the cause a translator can act on; `detail` is the
    /// download's own words, for "Ask for help" only.
    Failed {
        pin: PinLabel,
        why: PinFailure,
        detail: String,
    },
}

/// The download of a project's missing pins.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PinsState {
    /// `now` is asked for; `rest` follow it.
    Downloading {
        now: ResourcePin,
        rest: Vec<ResourcePin>,
    },
    /// `Ok`: every version the project pins is on this computer.
    Ended(Result<(), PinsStop>),
}

/// What became of the version being downloaded.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PinsEvent {
    Installed,
    Cancelled,
    Offline,
    Failed(PinFailure, String),
}

impl PinsState {
    /// The download of `missing`, in their order; with none, every version is here.
    pub fn start(missing: Vec<ResourcePin>) -> Self {
        let mut rest = missing.into_iter();
        match rest.next() {
            Some(now) => Self::Downloading {
                now,
                rest: rest.collect(),
            },
            None => Self::Ended(Ok(())),
        }
    }

    /// INV-OPEN-FROM-DOOR43-LEAVES-NO-PIN-MISSING: the state after `event`. The download ends
    /// `Ok` only by `Installed` on the last version; any other event ends it at once, and
    /// an ended download stays as it ended.
    #[must_use]
    pub fn next(self, event: PinsEvent) -> Self {
        let Self::Downloading { now, rest } = self else {
            return self;
        };
        match event {
            PinsEvent::Installed => Self::start(rest),
            PinsEvent::Cancelled => Self::Ended(Err(PinsStop::Cancelled)),
            PinsEvent::Offline => Self::Ended(Err(PinsStop::Offline)),
            PinsEvent::Failed(why, detail) => Self::Ended(Err(PinsStop::Failed {
                pin: label(&now),
                why,
                detail,
            })),
        }
    }
}

/// A project's pins as its pin file holds them (`ingredients/checking/resources.json`);
/// `None` for a file that cannot be read as pins, which counts as no pins, as the sync
/// result counts it (tC4's `missingPinsAfterSync`).
pub(crate) fn pins_of_file(bytes: &[u8]) -> Option<ProjectPins> {
    serde_json::from_slice(bytes)
        .ok()
        .and_then(|json| ProjectPins::from_resources_json(&json).ok())
}

/// A pin as the screens name it (`PinLabel`).
pub(crate) fn label(pin: &ResourcePin) -> PinLabel {
    PinLabel {
        repo_path: pin.repo.to_string(),
        version: pin.version.as_ref().map(ToString::to_string),
        sha: pin.sha.to_hex(),
    }
}

impl App {
    /// Installs every version `pins` names that this computer lacks, and nothing else: a
    /// version that is here is not asked for again. Each version goes to the job's progress
    /// as [`Phase::PinnedVersion`] when its download begins, and the job's cancel stops the
    /// download at its next chunk. Blocking reads of the resource store: call it off the
    /// async workers.
    pub(crate) async fn install_missing_pins(
        &self,
        pins: &ProjectPins,
        ctx: &JobCtx,
    ) -> Result<(), PinsStop> {
        let store = &self.inner.resources;
        let missing: Vec<ResourcePin> =
            tc_resources::resolve::missing_versions(pins, &|pin| store.has_dcs(pin))
                .into_iter()
                .cloned()
                .collect();
        let mut state = PinsState::start(missing);
        loop {
            let (now, left) = match &state {
                PinsState::Ended(end) => return end.clone(),
                PinsState::Downloading { now, rest } => (now.clone(), rest.len()),
            };
            let event = self.download_pin(&now, left, ctx).await;
            state = state.next(event);
        }
    }

    /// One pinned version: asked for, checked against the pinned commit, installed.
    async fn download_pin(&self, pin: &ResourcePin, left: usize, ctx: &JobCtx) -> PinsEvent {
        if ctx.cancel.is_cancelled() {
            return PinsEvent::Cancelled;
        }
        let client = match self.resources_client() {
            Ok(client) => client,
            Err(error) => return PinsEvent::Failed(PinFailure::Other, error.to_string()),
        };
        let phase = Phase::PinnedVersion {
            pin: label(pin),
            left: u32::try_from(left).unwrap_or(u32::MAX),
        };
        ctx.progress.phase(phase.clone(), None);
        let watch = JobWatch {
            progress: ctx.progress.clone(),
            cancel: ctx.cancel.clone(),
            phase,
        };
        let installed = install_dcs_watched(
            &self.inner.resources,
            &client,
            pin,
            Packaging::for_pin(pin),
            &watch,
        )
        .await;
        match installed {
            Ok(_) => PinsEvent::Installed,
            Err(InstallError::Door43(Door43Error::Cancelled { .. })) => PinsEvent::Cancelled,
            Err(InstallError::Door43(Door43Error::Offline { .. })) => PinsEvent::Offline,
            Err(error) => PinsEvent::Failed(failure_of(&error), error.to_string()),
        }
    }
}

/// The cause of a failed install that a translator can act on (the sentence's choice).
fn failure_of(error: &InstallError) -> PinFailure {
    match error {
        InstallError::Door43(door43) => match door43 {
            Door43Error::NotFound { .. } => PinFailure::NotOnDoor43,
            Door43Error::Verification { .. } => PinFailure::NotThePinnedVersion,
            Door43Error::Unreachable { .. }
            | Door43Error::Server { .. }
            | Door43Error::RateLimited { .. } => PinFailure::Unreachable,
            Door43Error::Disk { .. } => PinFailure::NotSaved,
            // The download asks for no sign-in and pushes nothing, and a cancel or the
            // internet switch ends it before this is asked: none of these has a sentence.
            Door43Error::Offline { .. }
            | Door43Error::Cancelled { .. }
            | Door43Error::AuthFailed { .. }
            | Door43Error::NoWriteAccess { .. }
            | Door43Error::RefRejected { .. }
            | Door43Error::RefMoved { .. }
            | Door43Error::NameExists { .. }
            | Door43Error::Rejected { .. }
            | Door43Error::UnexpectedResponse { .. }
            | Door43Error::TooLarge { .. }
            | Door43Error::Setup { .. } => PinFailure::Other,
        },
        InstallError::Store(_) => PinFailure::NotSaved,
        InstallError::Aquifer(_)
        | InstallError::Refused { .. }
        | InstallError::Lexicon { .. }
        | InstallError::NoTag { .. }
        | InstallError::Interrupted => PinFailure::Other,
    }
}

#[cfg(test)]
#[allow(
    clippy::unwrap_used,
    reason = "test code: a failed unwrap is a failed test"
)]
mod tests {
    use super::*;
    use proptest::prelude::*;

    fn pin(n: u8) -> ResourcePin {
        let repo = format!("git.door43.org/unfoldingWord/en_r{n}")
            .parse()
            .unwrap();
        let sha = format!("{n:02x}").repeat(20).parse().unwrap();
        ResourcePin::new(repo, sha)
    }

    fn event() -> impl Strategy<Value = PinsEvent> {
        prop_oneof![
            4 => Just(PinsEvent::Installed),
            1 => Just(PinsEvent::Cancelled),
            1 => Just(PinsEvent::Offline),
            1 => Just(PinsEvent::Failed(PinFailure::NotOnDoor43, "not found".to_owned())),
        ]
    }

    #[test]
    fn with_nothing_missing_every_version_is_here_at_once() {
        assert_eq!(PinsState::start(Vec::new()), PinsState::Ended(Ok(())));
    }

    #[test]
    fn a_failure_names_the_version_that_was_being_downloaded() {
        let state = PinsState::start(vec![pin(1), pin(2)])
            .next(PinsEvent::Installed)
            .next(PinsEvent::Failed(
                PinFailure::NotOnDoor43,
                "not found".to_owned(),
            ));
        assert_eq!(
            state,
            PinsState::Ended(Err(PinsStop::Failed {
                pin: label(&pin(2)),
                why: PinFailure::NotOnDoor43,
                detail: "not found".to_owned()
            }))
        );
    }

    proptest! {
        /// INV-OPEN-FROM-DOOR43-LEAVES-NO-PIN-MISSING: the download ends `Ok` only when
        /// every missing version was installed, in order; the first other event ends it as
        /// that event says, and nothing after an end changes it.
        #[test]
        fn the_download_ends_here_only_after_every_version_was_installed(
            n in 0u8..6,
            events in proptest::collection::vec(event(), 0..10),
        ) {
            let missing: Vec<ResourcePin> = (0..n).map(pin).collect();
            let mut state = PinsState::start(missing.clone());
            let mut installed = 0usize;
            let mut ended: Option<Result<(), PinsStop>> = (n == 0).then_some(Ok(()));
            for event in events {
                if ended.is_none() {
                    match &event {
                        PinsEvent::Installed => {
                            installed += 1;
                            if installed == missing.len() {
                                ended = Some(Ok(()));
                            }
                        }
                        PinsEvent::Cancelled => ended = Some(Err(PinsStop::Cancelled)),
                        PinsEvent::Offline => ended = Some(Err(PinsStop::Offline)),
                        PinsEvent::Failed(why, detail) => {
                            ended = Some(Err(PinsStop::Failed {
                                pin: label(&missing[installed]),
                                why: *why,
                                detail: detail.clone(),
                            }));
                        }
                    }
                }
                state = state.next(event);
                match (&state, &ended) {
                    (PinsState::Ended(end), Some(expected)) => prop_assert_eq!(end, expected),
                    (PinsState::Downloading { now, rest }, None) => {
                        prop_assert_eq!(now, &missing[installed]);
                        prop_assert_eq!(rest.as_slice(), &missing[installed + 1..]);
                    }
                    (state, ended) => prop_assert!(false, "{:?} but the model says {:?}", state, ended),
                }
            }
        }
    }
}
