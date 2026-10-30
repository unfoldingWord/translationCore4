//! Whether a click on a layer's scrim closes the layer (tC4's `Layer`). The browser sends the
//! click to the element that holds both ends of the press, so a press that starts in the panel
//! and ends on the scrim, or the other way round, clicks the scrim too (#852). Pure, so the host
//! tests it.

/// Where the press that ends in a click began.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Press {
    /// On the scrim, with no layer open inside this one.
    Scrim,
    /// On the scrim while a layer inside this one (a dropdown) is open: that press is the inner
    /// layer's outside press.
    ScrimUnderInnerLayer,
    /// Inside the panel.
    Panel,
}

/// Where the press ended.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Release {
    Scrim,
    Panel,
}

/// Whether the click closes the layer: only a press that starts and ends on the scrim, with no
/// inner layer to take it. `None` is a release with no press seen on the scrim.
pub fn closes(press: Option<Press>, release: Release) -> bool {
    press == Some(Press::Scrim) && release == Release::Scrim
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_press_and_release_on_the_scrim_closes() {
        assert!(closes(Some(Press::Scrim), Release::Scrim));
    }

    #[test]
    fn a_press_inside_the_panel_never_closes() {
        assert!(!closes(Some(Press::Panel), Release::Scrim));
        assert!(!closes(Some(Press::Panel), Release::Panel));
    }

    #[test]
    fn a_press_on_the_scrim_released_in_the_panel_does_not_close() {
        assert!(!closes(Some(Press::Scrim), Release::Panel));
    }

    #[test]
    fn a_press_that_closes_an_inner_layer_leaves_this_one_open() {
        assert!(!closes(Some(Press::ScrimUnderInnerLayer), Release::Scrim));
    }

    #[test]
    fn a_release_with_no_press_seen_does_not_close() {
        assert!(!closes(None, Release::Scrim));
    }
}
