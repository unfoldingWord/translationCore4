//! Release upgrades and the gateway change (unit C8; tC4 `ResourceUpdates.jsx`,
//! `UpgradeSet.jsx`, `GatewayChange.jsx`): tC4's `upgrade` slice and its `gatewayPreview`,
//! `gatewayBusy` and `gatewayError`. Pure; the requests are the server's, and what the dialogs
//! say is decided here so a host test can hold it.
//!
//! The server plans and keeps the plan; the person reads it; confirming sends its id. A
//! confirm that finds the project moved comes back with the plan made again, which replaces the
//! one shown, so the person reads the new figures before anything is written. A failed save
//! leaves the plan on screen with the reason, and Confirm tries again (tC4 #580).

use tc_api::check::{CheckCollection, Tool};
use tc_api::ids::Scope;
use tc_api::resources::{
    BlockReason, BlockedUnit, GatewayPackage, PlanRow, PlanView, PlanWhat, RepoMove, SetRung,
    TextKind, UpdatesView,
};

/// What the download of an upgrade is for (tC4 `upgrade.installing`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Installing {
    Set(SetRung),
    /// A scripture text, by its repository's name.
    Text(String),
}

/// Check for updates (INV-BUSY-ENDS-WITH-ITS-WORK): idle, or out for one open of a project.
/// Busy is read from here against the open on screen, so a check that another open started
/// never holds this one's button.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
enum Check {
    #[default]
    Idle,
    Running {
        at: Scope,
    },
    /// The check for `at` failed; `reason` is already tC4's sentence.
    Failed {
        at: Scope,
        reason: String,
    },
}

/// How a check for updates ended.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CheckEnd {
    Offers(UpdatesView),
    /// `reason` is already tC4's sentence.
    Failed(String),
    /// Nothing to show: the internet question took over, or the open it was for is not on
    /// screen any more.
    Nothing,
}

/// What Check for updates found, for the open it was asked for (tC4 `offersFor`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Offers {
    pub at: Scope,
    pub view: UpdatesView,
}

/// The confirmation the person is reading.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Preview {
    pub plan: PlanView,
    /// Confirm is on its way: both buttons wait.
    pub applying: bool,
}

/// One open's upgrade (INV-RESOURCE-ANSWER-HAS-AN-OWNER): the install, then the confirmation,
/// and what went wrong. Every answer names the open it was started for, and every reader the
/// open on screen, so one project's install or confirmation never shows over another.
#[derive(Debug, Clone, PartialEq, Eq)]
struct Flow {
    at: Scope,
    installing: Option<Installing>,
    /// The repository being downloaded (`sources.progress`).
    progress: Option<String>,
    /// A failed install or confirm, in tC4's words.
    error: Option<String>,
    preview: Option<Preview>,
}

impl Flow {
    fn new(at: Scope) -> Self {
        Self {
            at,
            installing: None,
            progress: None,
            error: None,
            preview: None,
        }
    }
}

/// tC4's `s.upgrade`.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct UpgradeState {
    check: Check,
    offers: Option<Offers>,
    flow: Option<Flow>,
}

impl UpgradeState {
    /// Whether a check for updates is out for `here`, the open on screen.
    pub fn checking(&self, here: Option<&Scope>) -> bool {
        matches!(&self.check, Check::Running { at } if Some(at) == here)
    }

    /// What the last check found, when it was made for `here`.
    pub fn offers_for(&self, here: Option<&Scope>) -> Option<&Offers> {
        self.offers.as_ref().filter(|o| Some(&o.at) == here)
    }

    /// What the last check for `here` could not do, in tC4's words: the check itself, or the
    /// scripture texts beside the offers it did read.
    pub fn check_error(&self, here: Option<&Scope>) -> Option<String> {
        match &self.check {
            Check::Failed { at, reason } if Some(at) == here => Some(reason.clone()),
            Check::Idle | Check::Running { .. } | Check::Failed { .. } => self
                .offers_for(here)
                .and_then(|o| o.view.texts_error)
                .map(check_failed),
        }
    }

    /// "Check for updates" was pressed for `at`. `false` while a check for `at` is out: a
    /// second one is not sent. A check another open left behind is replaced; its answer finds
    /// no owner.
    pub fn check_started(&mut self, at: Scope) -> bool {
        if self.checking(Some(&at)) {
            return false;
        }
        if let Some(flow) = self.flow_mut(&at) {
            flow.error = None;
        }
        self.check = Check::Running { at };
        self.offers = None;
        true
    }

    /// The check for `at` ended (INV-RESOURCE-ANSWER-HAS-AN-OWNER): only the check that is out
    /// for `at` takes the end, and it is busy no more whatever the end was.
    pub fn check_ended(&mut self, at: &Scope, end: CheckEnd) {
        if !self.checking(Some(at)) {
            return;
        }
        self.check = match end {
            CheckEnd::Offers(view) => {
                self.offers = Some(Offers {
                    at: at.clone(),
                    view,
                });
                Check::Idle
            }
            CheckEnd::Failed(reason) => Check::Failed {
                at: at.clone(),
                reason,
            },
            CheckEnd::Nothing => Check::Idle,
        };
    }

    /// The upgrade of `here`, the open on screen.
    fn flow(&self, here: Option<&Scope>) -> Option<&Flow> {
        self.flow.as_ref().filter(|f| Some(&f.at) == here)
    }

    /// The upgrade an answer for `at` belongs to: none once another open started its own.
    fn flow_mut(&mut self, at: &Scope) -> Option<&mut Flow> {
        self.flow.as_mut().filter(|f| f.at == *at)
    }

    /// What `here` is installing (tC4 `upgrade.installing`).
    pub fn installing(&self, here: Option<&Scope>) -> Option<&Installing> {
        self.flow(here)?.installing.as_ref()
    }

    /// The repository `here`'s install downloads now.
    pub fn progress(&self, here: Option<&Scope>) -> Option<&str> {
        self.flow(here)?.progress.as_deref()
    }

    /// `here`'s failed install or confirm, in tC4's words.
    pub fn error(&self, here: Option<&Scope>) -> Option<&str> {
        self.flow(here)?.error.as_deref()
    }

    /// The confirmation `here` is reading.
    pub fn preview(&self, here: Option<&Scope>) -> Option<&Preview> {
        self.flow(here)?.preview.as_ref()
    }

    /// An offer's Upgrade was pressed in `at`: nothing else can start there while it downloads.
    pub fn install_started(&mut self, at: Scope, what: Installing) {
        self.flow = Some(Flow {
            installing: Some(what),
            ..Flow::new(at)
        });
    }

    pub fn install_progress(&mut self, at: &Scope, repo: String) {
        if let Some(flow) = self.flow_mut(at)
            && flow.installing.is_some()
        {
            flow.progress = Some(repo);
        }
    }

    /// The release is installed and its plan is ready: the confirmation opens, in `at`.
    pub fn plan_ready(&mut self, at: &Scope, plan: PlanView) {
        // Only an install under way takes its plan: the guided fix's re-pin may have taken
        // the open's confirmation since, and it is not replaced under its reader.
        if let Some(flow) = self.flow_mut(at)
            && flow.installing.is_some()
        {
            flow.installing = None;
            flow.progress = None;
            flow.preview = Some(Preview {
                plan,
                applying: false,
            });
        }
    }

    /// The guided fix's re-pin has its plan: the same confirmation, started here for `at`.
    pub fn repin_ready(&mut self, at: Scope, plan: PlanView) {
        self.flow = Some(Flow {
            preview: Some(Preview {
                plan,
                applying: false,
            }),
            ..Flow::new(at)
        });
    }

    /// The download or the plan failed or was cancelled; the pins did not move.
    pub fn install_failed(&mut self, at: &Scope, reason: Option<String>) {
        if let Some(flow) = self.flow_mut(at)
            && flow.installing.is_some()
        {
            flow.installing = None;
            flow.progress = None;
            if reason.is_some() {
                flow.error = reason;
            }
        }
    }

    /// "Keep the current release" or the ✕ in `here`: nothing changes.
    pub fn cancel(&mut self, here: &Scope) {
        if let Some(flow) = self.flow_mut(here)
            && !flow.preview.as_ref().is_some_and(|p| p.applying)
        {
            flow.preview = None;
            flow.error = None;
        }
    }

    /// Confirm was pressed in `here`: the plan to send and the open it was made for, which is
    /// the one to send it with. `None` when it must not go: no plan of this open is on screen,
    /// the plan is blocked, or one is on its way.
    pub fn confirm_started(&mut self, here: &Scope) -> Option<tc_api::ids::PlanId> {
        let flow = self.flow_mut(here)?;
        let preview = flow.preview.as_mut()?;
        if preview.applying || !preview.plan.blocked.is_empty() {
            return None;
        }
        preview.applying = true;
        flow.error = None;
        Some(preview.plan.plan)
    }

    /// The plan of `at` was written: the offer it answered is spent.
    pub fn applied(&mut self, at: &Scope) {
        let Some(flow) = self.flow_mut(at) else {
            return;
        };
        flow.error = None;
        if let Some(preview) = flow.preview.take()
            && let (Some(offers), Some(spent)) = (&mut self.offers, spent_by(&preview.plan))
            && offers.at == *at
        {
            match spent {
                Spent::Set(rung) => {
                    if let Some(set) = offers.view.sets.iter_mut().find(|s| s.rung == rung) {
                        set.moves.clear();
                    }
                }
                Spent::Text(repo) => offers.view.texts.retain(|t| t.change.repo != repo),
            }
        }
    }

    /// The project moved under the plan: the plan made again is on screen to read.
    pub fn replanned(&mut self, at: &Scope, plan: PlanView) {
        if let Some(flow) = self.flow_mut(at) {
            flow.error = None;
            flow.preview = Some(Preview {
                plan,
                applying: false,
            });
        }
    }

    /// The save failed: the plan stays, with the reason, for another try.
    pub fn apply_failed(&mut self, at: &Scope, reason: String) {
        if let Some(flow) = self.flow_mut(at) {
            if let Some(preview) = &mut flow.preview {
                preview.applying = false;
            }
            flow.error = Some(reason);
        }
    }
}

enum Spent {
    Set(SetRung),
    Text(String),
}

fn spent_by(plan: &PlanView) -> Option<Spent> {
    match &plan.what {
        PlanWhat::Set { rung, .. } => Some(Spent::Set(*rung)),
        PlanWhat::Text { change, .. } => Some(Spent::Text(change.repo.clone())),
        PlanWhat::Repin { .. } | PlanWhat::Gateway(_) => None,
    }
}

/// One plain sentence per cause (tC4 #833.1), in place of tC4's `upgrade.checkFailed` with the
/// client's own text as its reason.
fn check_failed(why: tc_api::refusal::UpdateCheckFailure) -> String {
    crate::i18n::t_dyn(why.key(), &[], None)
}

/// What the gateway dialog shows while a plan is made or written.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum GatewayPreview {
    /// The plan could not be made: the error, and Close, never a Change that could mistake a
    /// failed read for success.
    Failed { package: Box<GatewayPackage> },
    Plan {
        package: Box<GatewayPackage>,
        plan: Box<PlanView>,
    },
}

/// tC4's `gatewayBusy`, `gatewayPreview` and `gatewayError`.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct GatewayState {
    /// A plan is being made or a change is being written: no second choice starts, and
    /// neither button answers (tC4 #580).
    pub busy: bool,
    pub preview: Option<GatewayPreview>,
    pub error: Option<String>,
}

impl GatewayState {
    /// A package was chosen. `false` when a change is already previewed or under way: a second
    /// choice does nothing (tC4 #580, interruption 3).
    pub fn asking(&mut self) -> bool {
        if self.busy || self.preview.is_some() {
            return false;
        }
        self.busy = true;
        self.error = None;
        true
    }

    /// The plan is ready. A plan for the package already in use asks nothing: Get source texts
    /// can still offer it while its step is open, and Keep and Change would name one package
    /// (#855).
    pub fn planned(&mut self, package: GatewayPackage, plan: PlanView) {
        self.busy = false;
        let in_use = match &plan.what {
            PlanWhat::Gateway(change) => change
                .from
                .as_ref()
                .is_some_and(|from| from.gateway.is_same_package(&package.gateway)),
            PlanWhat::Set { .. } | PlanWhat::Text { .. } | PlanWhat::Repin { .. } => false,
        };
        if in_use {
            return;
        }
        self.preview = Some(GatewayPreview::Plan {
            package: Box::new(package),
            plan: Box::new(plan),
        });
    }

    /// The plan could not be made, or the work before it could not finish.
    pub fn plan_failed(&mut self, package: GatewayPackage, reason: String) {
        self.busy = false;
        self.preview = Some(GatewayPreview::Failed {
            package: Box::new(package),
        });
        self.error = Some(reason);
    }

    /// "Keep …" or the ✕. After Change nothing cancels: the buttons are off until it ends.
    pub fn cancel(&mut self) {
        if self.busy {
            return;
        }
        self.preview = None;
        self.error = None;
    }

    /// Change was pressed. `false` when it must not go: the dialog holds no plan, a unit is
    /// blocked, or a change is already on its way.
    pub fn confirm_started(&mut self) -> bool {
        if self.busy {
            return false;
        }
        let Some(GatewayPreview::Plan { plan, .. }) = &self.preview else {
            return false;
        };
        if !plan.blocked.is_empty() {
            return false;
        }
        self.busy = true;
        self.error = None;
        true
    }

    pub fn applied(&mut self) {
        self.busy = false;
        self.preview = None;
        self.error = None;
    }

    /// The project moved under the plan: the plan made again replaces the one shown.
    pub fn replanned(&mut self, plan: PlanView) {
        self.busy = false;
        self.error = None;
        if let Some(GatewayPreview::Plan { plan: shown, .. }) = &mut self.preview {
            **shown = plan;
        }
    }

    /// The save failed: the dialog stays on its plan, states why, and Change tries again.
    pub fn apply_failed(&mut self, reason: String) {
        self.busy = false;
        self.error = Some(reason);
    }
}

// ---- what the dialogs say ----------------------------------------------------------------

/// A (tool, book) in the sentences of the dialogs (`check.tool.*`).
pub fn tool_key(tool: Tool) -> crate::i18n::Key {
    match tool {
        Tool::TranslationNotes => crate::i18n::keys::check::tool::TRANSLATION_NOTES,
        Tool::TranslationWords => crate::i18n::keys::check::tool::TRANSLATION_WORDS,
    }
}

/// The unit's name: a book's English name, or the stories'.
pub fn unit_name(unit: CheckCollection) -> String {
    match unit {
        CheckCollection::Book(book) => book.english_name().to_owned(),
        CheckCollection::Stories => "Open Bible Stories".to_owned(),
    }
}

/// One row of the per-book list: tC4's `gateway.carryOver` when the carry-over was counted,
/// else `gateway.affectedRow`.
pub fn row_text(row: &PlanRow) -> String {
    use crate::i18n::{keys::gateway, t};
    let (book, tool) = (unit_name(row.unit), t(tool_key(row.tool), &[]));
    match row.carry {
        Some(carry) => t(
            gateway::CARRY_OVER,
            &[
                ("book", &book),
                ("tool", &tool),
                ("carried", &carry.carried),
                ("invalidated", &carry.check_again),
            ],
        ),
        None => t(
            gateway::AFFECTED_ROW,
            &[
                ("book", &book),
                ("tool", &tool),
                ("n", &row.decisions),
                ("resource", &row.against),
            ],
        ),
    }
}

/// The callout of a plan that cannot be confirmed (tC4 `gateway.blocked*`): the remedy depends on
/// why, so the first unit with a reason of its own decides the sentence.
pub fn blocked_text(blocked: &[BlockedUnit]) -> String {
    use crate::i18n::{keys::gateway, t};
    let books = blocked
        .iter()
        .map(|b| format!("{} ({})", unit_name(b.unit), t(tool_key(b.tool), &[])))
        .collect::<Vec<_>>()
        .join(", ");
    let key = match blocked
        .iter()
        .map(|b| b.reason)
        .find(|r| *r != BlockReason::NoResource)
    {
        Some(BlockReason::VersificationUnknown) => gateway::BLOCKED_VERSIFICATION_UNKNOWN,
        Some(BlockReason::NoResource) | None => gateway::BLOCKED,
    };
    t(key, &[("books", &books)])
}

/// The headline and detail of the gateway change (tC4 `describeConsequences`). tC4 writes them
/// in English whatever the language of the app, which is kept: a translated sentence needs
/// the catalogs' words first.
pub fn gateway_headline(plan: &PlanView) -> (String, Option<String>) {
    if plan.harmless() || plan.decisions_at_risk == 0 {
        return (
            "Nothing you have already checked will be affected.".to_owned(),
            None,
        );
    }
    let mut books: Vec<String> = Vec::new();
    for row in &plan.rows {
        let name = unit_name(row.unit);
        if !books.contains(&name) {
            books.push(name);
        }
    }
    let named: Vec<&String> = books.iter().take(3).collect();
    let more = books.len() - named.len();
    let list = if more > 0 {
        format!(
            "{} and {more} more",
            named
                .iter()
                .map(|s| s.as_str())
                .collect::<Vec<_>>()
                .join(", ")
        )
    } else {
        named
            .iter()
            .map(|s| s.as_str())
            .collect::<Vec<_>>()
            .join(" and ")
    };
    let n = plan.decisions_at_risk;
    (
        format!(
            "{n} decision{} in {list} were made against the notes you are leaving.",
            if n == 1 { "" } else { "s" }
        ),
        Some(
            "Decisions that match a check in the new notes carry over. The rest stop applying, so \
             those checks come back as work — a book that was finished will not be finished any \
             more. Nothing is deleted."
                .to_owned(),
        ),
    )
}

/// The gateway change's Keep and Change labels: `from`, the checking language in use, and `to`,
/// the one chosen. Two packages of one language share an autonym (fr from Xenizo and from
/// MVHS), so then each also names its owner, as Get source texts does (#855).
pub fn gateway_buttons(from: Option<&GatewayPackage>, to: &GatewayPackage) -> (String, String) {
    use crate::i18n::{keys::gateway, t};
    let same_name = from.is_some_and(|from| from.autonym == to.autonym);
    let name = |p: &GatewayPackage| {
        if same_name {
            format!("{} · {}", p.autonym, p.gateway.owner)
        } else {
            p.autonym.clone()
        }
    };
    let keep = t(
        gateway::KEEP,
        &[("lang", &from.map_or_else(|| t(gateway::CURRENT, &[]), name))],
    );
    (keep, t(gateway::CHANGE, &[("lang", &name(to))]))
}

/// The moves a confirmation lists, as `upgrade.move` writes them.
pub fn move_text(change: &RepoMove) -> String {
    crate::i18n::t(
        crate::i18n::keys::upgrade::MOVE,
        &[
            ("repo", &change.repo),
            ("from", &change.from),
            ("to", &change.to),
        ],
    )
}

/// What a confirmation of a text upgrade says first: no alignment changes for a gateway Bible,
/// or the verses whose alignments an original-language text marks (tC4 `TextUpgrade`).
pub fn text_headline(kind: TextKind, alignments: Option<u32>) -> (String, bool) {
    use crate::i18n::{keys::upgrade, t};
    match (kind, alignments) {
        (TextKind::Original, Some(n)) if n > 0 => {
            (t(upgrade::TEXT_INVALIDATES, &[("n", &n)]), true)
        }
        (TextKind::Original, _) => (t(upgrade::TEXT_NO_ALIGNMENTS, &[]), false),
        (TextKind::Gateway, _) => (t(upgrade::TEXT_GATEWAY, &[]), false),
    }
}
