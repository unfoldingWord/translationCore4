//! A download of the versions a project pins and this computer lacks, as a screen shows it
//! while it runs (#1013): the open from Door43's dialog and a syncing project's card. Pure.
//!
//! The job reports each version as `Phase::PinnedVersion`, with the bytes received and the
//! size Door43 announced. The screen names the version, says how many follow it, draws a bar,
//! and offers Cancel until Cancel is pressed.

use tc_api::ids::JobId;
use tc_api::jobs::{Phase, Progress};

/// The version downloading now.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Downloading {
    /// The job that downloads it, which Cancel stops.
    pub job: JobId,
    /// The version as the screen names it (`en_ult v91`).
    pub pin: String,
    /// How many versions follow it.
    pub left: u32,
    /// The bytes received so far.
    pub received: u64,
    /// The size Door43 announced, when it announced one.
    pub size: Option<u64>,
}

impl Downloading {
    /// What `job`'s progress report says it downloads, when it downloads a pinned version.
    pub fn of(job: JobId, progress: &Progress) -> Option<Self> {
        let Phase::PinnedVersion { pin, left } = &progress.phase else {
            return None;
        };
        Some(Self {
            job,
            pin: pin.name(),
            left: *left,
            received: progress.done,
            size: progress.total,
        })
    }

    /// The bar's value, 0 to 100, or `None` for a bar with no known end: Door43 announced no
    /// size.
    pub fn percent(&self) -> Option<f64> {
        let size = self.size.filter(|size| *size > 0)?;
        #[allow(
            clippy::cast_precision_loss,
            reason = "sizes are far below 2^52, so the float holds them exactly"
        )]
        Some((self.received.min(size) as f64 / size as f64) * 100.0)
    }
}

/// A download that runs, and whether Cancel was pressed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PinDownload {
    /// Cancel stops it.
    Running(Downloading),
    /// Cancel was pressed: the job is stopping.
    Stopping(Downloading),
}

impl PinDownload {
    /// The version the screen names.
    pub fn download(&self) -> &Downloading {
        match self {
            Self::Running(download) | Self::Stopping(download) => download,
        }
    }

    /// Whether Cancel stops the download now.
    pub fn can_cancel(&self) -> bool {
        matches!(self, Self::Running(_))
    }

    /// The job's newer report. Once Cancel was pressed, a report on its way does not bring
    /// Cancel back; it still moves the bar.
    pub fn report(&mut self, newer: Downloading) {
        match self {
            Self::Running(download) | Self::Stopping(download) => *download = newer,
        }
    }

    /// Cancel pressed: the job to stop, or `None` when Cancel was pressed already.
    pub fn cancel(&mut self) -> Option<JobId> {
        let Self::Running(download) = self else {
            return None;
        };
        let download = download.clone();
        let job = download.job;
        *self = Self::Stopping(download);
        Some(job)
    }

    /// The cancel did not reach the app's server: Cancel can be pressed again.
    pub fn cancel_not_sent(&mut self) {
        if let Self::Stopping(download) = self {
            *self = Self::Running(download.clone());
        }
    }
}
