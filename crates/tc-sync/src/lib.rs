//! Door43 sync and USB exchange (`docs/STORAGE.md` §9, §10).
//!
//! [`machine`] holds the steps of one sync as a pure, total function; the executors drive it
//! with the store and the Door43 client, so what a step may do after a failure is decided in
//! one place.

pub mod connect;
pub mod exchange;
pub mod join;
pub mod machine;
mod names;
pub mod share;
pub mod sync;
pub mod username;

pub use connect::{ConnectError, connect};
pub use join::{JoinError, Joined, join};
pub use share::{ShareError, share};
pub use sync::{Backoff, OtherToolCommit, Pause, SyncReport, sync};
pub use username::{UsernameError, record_username};

/// What stops a teammate's work of `header`'s format from coming in, by sync (§9.2 N1) or by
/// file (§10.2 R3), or `None` when it may: one answer for both.
pub(crate) fn newer_format(
    header: &tc_journal::format::FormatHeader,
) -> Option<tc_api::refusal::NewerFormat> {
    use tc_api::refusal::NewerFormat;
    use tc_journal::format::FormatGate;
    let number = |n: &tc_journal::FormatNumber| n.to_string().parse::<u16>().unwrap_or(u16::MAX);
    match header.gate() {
        FormatGate::Writable => None,
        FormatGate::ReadOnly { .. } => Some(NewerFormat::ReaderMinor {
            major: number(&header.major),
            min_reader_minor: number(&header.min_reader_minor),
        }),
        FormatGate::Refused { .. } => Some(NewerFormat::Major {
            major: number(&header.major),
        }),
        // Format 1 is the first major: what a teammate on an older one gets waits on #938.
        FormatGate::NeedsMigration { .. } => None,
    }
}

/// A change that is bookkeeping, not a translator's work: a device's profile (its Door43
/// username, Q7) and the resource pins an open's upgrade writes (owner ruling 2026-10-26). It
/// joins the project and the Received sheet's rows, but the count of received work leaves it
/// out.
pub fn is_bookkeeping(record: &tc_journal::Record) -> bool {
    matches!(
        record,
        tc_journal::Record::DeviceProfile { .. } | tc_journal::Record::Pins { .. }
    )
}
