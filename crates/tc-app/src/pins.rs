//! Downloading the versions a project pins and this computer lacks (#1013; owner rulings of
//! 2026-11-12: the download asks no question; at an open from Door43 a cancel or a failed
//! download adds no project; in a sync, a cancel or a failed download leaves the sync in place).
//!
//! The download is a state machine: one pinned version at a time, in the order
//! `tc_resources::resolve::missing_versions` gives. Each install is `install_dcs_watched`, the
//! one download of a pinned version: it checks the download against the pinned commit and
//! installs whole or not at all, so a version that finished before a cancel or a failure
//! stays, and nothing of the one that did not finish is kept. What a failed version does to
//! the rest is the caller's [`OnFailure`].

use tc_api::jobs::Phase;
use tc_api::refusal::PinFailure;
use tc_api::resources::PinLabel;
use tc_door43::Door43Error;
use tc_resources::{InstallError, Packaging, ProjectPins, ResourcePin, install_dcs_watched};

use crate::app::App;
use crate::jobs::JobCtx;
use crate::resources::JobWatch;

/// What a version that was not downloaded does to the versions after it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OnFailure {
    /// The rest are not asked for: an open adds no project once one version failed.
    Stop,
    /// The rest are still asked for after a failure of that one version ([`Reach::ThisVersion`]):
    /// a sync stands, and each version it gets is one fewer missing. A failure that would
    /// fail every version after it ([`Reach::EveryVersion`]) ends the download, so it asks
    /// no further and names no further.
    GoOn,
}

/// Which versions a failure is about.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Reach {
    /// Door43 answered about this version: it does not have it, sent another commit, failed
    /// on its archive, or sent one that cannot be installed. The next version may still come.
    ThisVersion,
    /// The connection or this computer failed: no answer, the gateway in front of Door43
    /// failed, Door43 asked to slow down, the disk cannot keep it, the client cannot start.
    /// The next version would fail the same way.
    EveryVersion,
}

/// A version the download did not get. `why` is the cause a translator can act on; `detail`
/// is the download's own words, for "Ask for help" only.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NotDownloaded {
    pub pin: PinLabel,
    pub why: PinFailure,
    pub detail: String,
}

/// Why the download stopped before it asked for every version.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PinsHalt {
    /// The person cancelled.
    Cancelled,
    /// The internet was turned off.
    Offline,
}

/// How the download ended: the versions it did not get, in order, and whether it stopped
/// before it asked for every one.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct PinsEnd {
    pub failed: Vec<NotDownloaded>,
    pub halted: Option<PinsHalt>,
}

/// Why an open's download ended before every version was here.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PinsStop {
    Cancelled,
    Offline,
    Failed {
        pin: PinLabel,
        why: PinFailure,
        detail: String,
    },
}

impl PinsEnd {
    /// INV-OPEN-FROM-DOOR43-LEAVES-NO-PIN-MISSING: `Ok` only when the download got every
    /// version it was to get and was not stopped.
    pub fn all_here(self) -> Result<(), PinsStop> {
        match (self.halted, self.failed.into_iter().next()) {
            (Some(PinsHalt::Cancelled), _) => Err(PinsStop::Cancelled),
            (Some(PinsHalt::Offline), _) => Err(PinsStop::Offline),
            (None, Some(NotDownloaded { pin, why, detail })) => {
                Err(PinsStop::Failed { pin, why, detail })
            }
            (None, None) => Ok(()),
        }
    }
}

/// The download of a project's missing pins.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PinsState {
    /// `now` is asked for; `rest` follow it; `failed` were not downloaded.
    Downloading {
        // Boxed: a pin is large, and the ended state is small (`large_enum_variant`).
        now: Box<ResourcePin>,
        rest: Vec<ResourcePin>,
        failed: Vec<NotDownloaded>,
        on_failure: OnFailure,
    },
    Ended(PinsEnd),
}

/// What became of the version being downloaded.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PinsEvent {
    Installed,
    Cancelled,
    Offline,
    Failed {
        why: PinFailure,
        reach: Reach,
        detail: String,
    },
}

impl PinsState {
    /// The download of `missing`, in their order; with none, every version is here.
    pub fn start(missing: Vec<ResourcePin>, on_failure: OnFailure) -> Self {
        Self::next_of(missing, Vec::new(), on_failure)
    }

    fn next_of(rest: Vec<ResourcePin>, failed: Vec<NotDownloaded>, on_failure: OnFailure) -> Self {
        let mut rest = rest.into_iter();
        match rest.next() {
            Some(now) => Self::Downloading {
                now: Box::new(now),
                rest: rest.collect(),
                failed,
                on_failure,
            },
            None => Self::Ended(PinsEnd {
                failed,
                halted: None,
            }),
        }
    }

    /// The state after `event`. Every version is asked for once, in order. A cancel or the
    /// internet switch ends the download at once; a failed version ends it under
    /// [`OnFailure::Stop`], and under [`OnFailure::GoOn`] is passed over when the failure is
    /// that version's alone. An ended download stays as it ended.
    #[must_use]
    pub fn next(self, event: PinsEvent) -> Self {
        let Self::Downloading {
            now,
            rest,
            mut failed,
            on_failure,
        } = self
        else {
            return self;
        };
        let halt = |halted, failed| {
            Self::Ended(PinsEnd {
                failed,
                halted: Some(halted),
            })
        };
        match event {
            PinsEvent::Installed => Self::next_of(rest, failed, on_failure),
            PinsEvent::Cancelled => halt(PinsHalt::Cancelled, failed),
            PinsEvent::Offline => halt(PinsHalt::Offline, failed),
            PinsEvent::Failed { why, reach, detail } => {
                failed.push(NotDownloaded {
                    pin: label(&now),
                    why,
                    detail,
                });
                match (on_failure, reach) {
                    (OnFailure::GoOn, Reach::ThisVersion) => {
                        Self::next_of(rest, failed, on_failure)
                    }
                    (OnFailure::GoOn, Reach::EveryVersion) | (OnFailure::Stop, _) => {
                        Self::Ended(PinsEnd {
                            failed,
                            halted: None,
                        })
                    }
                }
            }
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
    /// as [`Phase::PinnedVersion`] when its download begins, with its bytes as they arrive,
    /// and the job's cancel stops the download at its next chunk. It reads the resource
    /// store's install records on the calling thread, one small read per version, as the
    /// guided fix's download does.
    pub(crate) async fn install_missing_pins(
        &self,
        pins: &ProjectPins,
        ctx: &JobCtx,
        on_failure: OnFailure,
    ) -> PinsEnd {
        let store = &self.inner.resources;
        let missing: Vec<ResourcePin> =
            tc_resources::resolve::missing_versions(pins, &|pin| store.has_dcs(pin))
                .into_iter()
                .cloned()
                .collect();
        let mut state = PinsState::start(missing, on_failure);
        loop {
            let (now, left) = match &state {
                PinsState::Ended(end) => return end.clone(),
                PinsState::Downloading { now, rest, .. } => (now.clone(), rest.len()),
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
            Err(error) => {
                return PinsEvent::Failed {
                    why: PinFailure::Other,
                    reach: Reach::EveryVersion,
                    detail: error.to_string(),
                };
            }
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
            Err(error) => {
                let (why, reach) = failure_of(&error);
                PinsEvent::Failed {
                    why,
                    reach,
                    detail: error.to_string(),
                }
            }
        }
    }
}

/// The cause of a failed install that a translator can act on (the sentence's choice), and
/// which versions it is about.
fn failure_of(error: &InstallError) -> (PinFailure, Reach) {
    use Reach::{EveryVersion, ThisVersion};
    match error {
        InstallError::Door43(door43) => match door43 {
            Door43Error::NotFound { .. } => (PinFailure::NotOnDoor43, ThisVersion),
            Door43Error::Verification { .. } => (PinFailure::NotThePinnedVersion, ThisVersion),
            Door43Error::Unreachable { .. } | Door43Error::RateLimited { .. } => {
                (PinFailure::Unreachable, EveryVersion)
            }
            // A 502, 503 or 504 comes from the gateway in front of Door43, which answers every
            // version the same way, a 504 only after its own wait. Any other server error is
            // Door43's answer about this archive.
            Door43Error::Server {
                status: 502..=504, ..
            } => (PinFailure::Unreachable, EveryVersion),
            Door43Error::Server { .. } => (PinFailure::Unreachable, ThisVersion),
            Door43Error::Disk { .. } => (PinFailure::NotSaved, EveryVersion),
            // The download asks for no sign-in and pushes nothing, and a cancel or the
            // internet switch ends it before this is asked: none of these has a sentence.
            Door43Error::Offline { .. }
            | Door43Error::Cancelled { .. }
            | Door43Error::Setup { .. } => (PinFailure::Other, EveryVersion),
            Door43Error::AuthFailed { .. }
            | Door43Error::NoWriteAccess { .. }
            | Door43Error::RefRejected { .. }
            | Door43Error::RefMoved { .. }
            | Door43Error::NameExists { .. }
            | Door43Error::Rejected { .. }
            | Door43Error::UnexpectedResponse { .. }
            | Door43Error::TooLarge { .. } => (PinFailure::Other, ThisVersion),
        },
        InstallError::Store(_) => (PinFailure::NotSaved, EveryVersion),
        InstallError::Interrupted => (PinFailure::Other, EveryVersion),
        InstallError::Aquifer(_)
        | InstallError::Refused { .. }
        | InstallError::Lexicon { .. }
        | InstallError::NoTag { .. } => (PinFailure::Other, ThisVersion),
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
            2 => Just(gone(PinFailure::NotOnDoor43, "not found")),
            1 => Just(PinsEvent::Failed {
                why: PinFailure::Unreachable,
                reach: Reach::EveryVersion,
                detail: "no answer".to_owned(),
            }),
        ]
    }

    fn policy() -> impl Strategy<Value = OnFailure> {
        prop_oneof![Just(OnFailure::Stop), Just(OnFailure::GoOn)]
    }

    /// A failure of one version alone.
    fn gone(why: PinFailure, detail: &str) -> PinsEvent {
        PinsEvent::Failed {
            why,
            reach: Reach::ThisVersion,
            detail: detail.to_owned(),
        }
    }

    fn not_found(n: u8) -> NotDownloaded {
        failure(n, PinFailure::NotOnDoor43, "not found")
    }

    fn failure(n: u8, why: PinFailure, detail: &str) -> NotDownloaded {
        NotDownloaded {
            pin: label(&pin(n)),
            why,
            detail: detail.to_owned(),
        }
    }

    #[test]
    fn with_nothing_missing_every_version_is_here_at_once() {
        for on_failure in [OnFailure::Stop, OnFailure::GoOn] {
            let state = PinsState::start(Vec::new(), on_failure);
            assert_eq!(state, PinsState::Ended(PinsEnd::default()));
        }
    }

    #[test]
    fn an_open_stops_at_the_version_that_failed_and_names_it() {
        let state = PinsState::start(vec![pin(1), pin(2), pin(3)], OnFailure::Stop)
            .next(PinsEvent::Installed)
            .next(gone(PinFailure::NotOnDoor43, "not found"));
        let PinsState::Ended(end) = state else {
            panic!("the open's download ends at the failure: {state:?}");
        };
        assert_eq!(
            end.all_here(),
            Err(PinsStop::Failed {
                pin: label(&pin(2)),
                why: PinFailure::NotOnDoor43,
                detail: "not found".to_owned()
            })
        );
    }

    #[test]
    fn a_failure_of_one_archive_passes_on_and_one_of_the_connection_ends() {
        let route = || "/unfoldingWord/en_tn/archive/v92.zip".to_owned();
        let door43 = |error| failure_of(&InstallError::Door43(error)).1;
        for error in [
            Door43Error::NotFound {
                route: route(),
                message: "not found".to_owned(),
            },
            Door43Error::Server {
                route: route(),
                status: 500,
                message: "archive failed".to_owned(),
            },
            Door43Error::TooLarge {
                route: route(),
                limit: 1,
            },
        ] {
            assert_eq!(door43(error), Reach::ThisVersion);
        }
        for status in [502, 503, 504] {
            let gateway = Door43Error::Server {
                route: route(),
                status,
                message: "gateway".to_owned(),
            };
            assert_eq!(door43(gateway), Reach::EveryVersion, "HTTP {status}");
        }
        assert_eq!(
            door43(Door43Error::RateLimited {
                route: route(),
                retry_after: None,
            }),
            Reach::EveryVersion
        );
        assert_eq!(
            failure_of(&InstallError::Interrupted).1,
            Reach::EveryVersion
        );
    }

    #[test]
    fn a_sync_ends_its_download_when_door43_does_not_answer() {
        let state =
            PinsState::start(vec![pin(1), pin(2)], OnFailure::GoOn).next(PinsEvent::Failed {
                why: PinFailure::Unreachable,
                reach: Reach::EveryVersion,
                detail: "no answer".to_owned(),
            });
        assert_eq!(
            state,
            PinsState::Ended(PinsEnd {
                failed: vec![failure(1, PinFailure::Unreachable, "no answer")],
                halted: None,
            })
        );
    }

    #[test]
    fn a_sync_passes_over_a_version_that_failed_and_gets_the_rest() {
        let state = PinsState::start(vec![pin(1), pin(2), pin(3)], OnFailure::GoOn)
            .next(gone(PinFailure::NotOnDoor43, "not found"))
            .next(PinsEvent::Installed)
            .next(PinsEvent::Installed);
        assert_eq!(
            state,
            PinsState::Ended(PinsEnd {
                failed: vec![not_found(1)],
                halted: None,
            })
        );
    }

    proptest! {
        /// INV-OPEN-FROM-DOOR43-LEAVES-NO-PIN-MISSING and INV-A-SYNC-LEAVES-NO-PIN-MISSING:
        /// every missing version is asked for once, in order; the download ends with no
        /// failure and no halt only when each was installed; a cancel or the internet switch
        /// ends it at once; a failure ends it under `Stop`, and under `GoOn` unless Door43
        /// answered for that version; nothing after the end changes it.
        #[test]
        fn the_download_asks_for_each_version_once_and_ends_as_its_events_say(
            n in 0u8..6,
            on_failure in policy(),
            events in proptest::collection::vec(event(), 0..12),
        ) {
            let missing: Vec<ResourcePin> = (0..n).map(pin).collect();
            let mut state = PinsState::start(missing.clone(), on_failure);
            let mut at = 0usize;
            let mut failed: Vec<NotDownloaded> = Vec::new();
            let mut ended: Option<PinsEnd> = (n == 0).then(PinsEnd::default);
            for event in events {
                if ended.is_none() {
                    match &event {
                        PinsEvent::Installed => at += 1,
                        PinsEvent::Cancelled => {
                            ended = Some(PinsEnd { failed: failed.clone(), halted: Some(PinsHalt::Cancelled) });
                        }
                        PinsEvent::Offline => {
                            ended = Some(PinsEnd { failed: failed.clone(), halted: Some(PinsHalt::Offline) });
                        }
                        PinsEvent::Failed { why, reach, detail } => {
                            failed.push(failure(u8::try_from(at).unwrap(), *why, detail));
                            at += 1;
                            let goes_on = on_failure == OnFailure::GoOn
                                && *reach == Reach::ThisVersion;
                            if !goes_on {
                                ended = Some(PinsEnd { failed: failed.clone(), halted: None });
                            }
                        }
                    }
                    if ended.is_none() && at == missing.len() {
                        ended = Some(PinsEnd { failed: failed.clone(), halted: None });
                    }
                }
                state = state.next(event);
                match (&state, &ended) {
                    (PinsState::Ended(end), Some(expected)) => prop_assert_eq!(end, expected),
                    (PinsState::Downloading { now, rest, failed: so_far, .. }, None) => {
                        prop_assert_eq!(now.as_ref(), &missing[at]);
                        prop_assert_eq!(rest.as_slice(), &missing[at + 1..]);
                        prop_assert_eq!(so_far, &failed);
                    }
                    (state, ended) => prop_assert!(false, "{:?} but the model says {:?}", state, ended),
                }
            }
        }
    }
}
