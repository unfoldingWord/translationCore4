//! The status of a download of the versions a project pins (#1013): the version, how many
//! follow it, and a bar for its bytes. The open from Door43's dialog and a syncing card show
//! it the same way.

use leptos::prelude::*;

use crate::app::pin_download::Downloading;
use crate::ds::{Attrs, Progress, Tone};
use crate::i18n::{keys, t};

/// "Downloading en_tn v91, which this project uses. Versions left after this one: 8." and the
/// bar under it, which has no end while Door43 announced no size.
pub fn download_status(download: &Downloading, testid: &'static str) -> impl IntoView + use<> {
    let (pin, left) = (download.pin.clone(), download.left.to_string());
    let percent = download.percent();
    let label = t(
        keys::open_door43::DOWNLOADING,
        &[("pin", &pin), ("n", &left)],
    );
    view! {
        <div style="display: flex; flex-direction: column; gap: 6px; min-width: 0;">
            <span>{label.clone()}</span>
            <Progress
                value=Signal::derive(move || percent)
                tone=Tone::Valid
                height=5.0
                label=label
                attrs=Attrs::from([("data-testid", testid)])
            />
        </div>
    }
}
