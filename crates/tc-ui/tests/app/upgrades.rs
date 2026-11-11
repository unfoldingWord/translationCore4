//! The confirmations of a release upgrade and of a new checking language (unit C8): what the
//! dialogs hold while a plan is made, shown, confirmed again after the project moved, or refused
//! by the disk, and the words they say. tC4's `UpgradeSet.jsx` and `GatewayChange.jsx`.

use proptest::prelude::*;
use tc_api::check::{CheckCollection, Tool};
use tc_api::ids::{Epoch, PlanId, ProjectRef, Scope};
use tc_api::resources::{
    BlockReason, BlockedUnit, Carry, GatewayChange, GatewayPackage, GatewayRef, PlanRow, PlanView,
    PlanWhat, RepoMove, Seen, SetOffer, SetRung, TextKind, TextOffer, UpdatesView,
};
use tc_api::shown::Direction;
use tc_core::BookId;
use tc_ui::app::upgrades::{
    CheckEnd, GatewayPreview, GatewayState, Installing, UpgradeState, blocked_text,
    gateway_buttons, gateway_headline, row_text, text_headline,
};

fn package() -> GatewayPackage {
    GatewayPackage {
        gateway: GatewayRef {
            language: "en".into(),
            owner: "unfoldingWord".into(),
        },
        name: "English".into(),
        autonym: "English".into(),
        direction: Direction::Ltr,
        seen: Seen {
            tn: "v89".into(),
            tw: "v89".into(),
            ta: "v89".into(),
        },
    }
}

fn change(repo: &str) -> RepoMove {
    RepoMove {
        repo: repo.into(),
        from: "v18".into(),
        to: "v19".into(),
        published: None,
    }
}

fn row(tool: Tool, book: BookId, decisions: u32, carry: Option<(u32, u32)>) -> PlanRow {
    PlanRow {
        tool,
        unit: CheckCollection::Book(book),
        decisions,
        against: "es-419_twl".into(),
        carry: carry.map(|(carried, check_again)| Carry {
            carried,
            check_again,
        }),
    }
}

fn plan(id: u64, what: PlanWhat, rows: Vec<PlanRow>, blocked: Vec<BlockedUnit>) -> PlanView {
    PlanView {
        plan: PlanId::new(id),
        what,
        decisions_at_risk: rows.iter().map(|r| r.decisions).sum(),
        rows,
        blocked,
        alignments: None,
    }
}

fn set_plan(id: u64, rows: Vec<PlanRow>) -> PlanView {
    plan(
        id,
        PlanWhat::Set {
            rung: SetRung::Primary,
            language: "es-419".into(),
            moves: vec![change("es-419_twl")],
        },
        rows,
        Vec::new(),
    )
}

fn project(name: &str) -> ProjectRef {
    ProjectRef::parse(name).unwrap()
}

/// One open of `name`: the same project opened again has another epoch.
fn open(name: &str, epoch: u64) -> Scope {
    Scope {
        project: project(name),
        epoch: Epoch::new(epoch),
    }
}

fn no_offers() -> UpdatesView {
    UpdatesView {
        sets: Vec::new(),
        texts: Vec::new(),
        texts_error: None,
    }
}

#[test]
fn an_answer_for_a_project_the_person_has_left_is_dropped() {
    let (alef, bet) = (open("alef", 1), open("bet", 2));
    let mut up = UpgradeState::default();
    assert!(up.check_started(alef.clone()));
    assert!(
        !up.checking(Some(&bet)) && !up.checking(None),
        "INV-BUSY-ENDS-WITH-ITS-WORK: alef's check holds the button of bet or of Home"
    );
    assert!(
        up.check_started(bet.clone()),
        "INV-BUSY-ENDS-WITH-ITS-WORK: alef's check keeps bet's from starting"
    );
    up.check_ended(&alef, CheckEnd::Offers(no_offers()));
    assert!(
        up.offers_for(Some(&bet)).is_none() && up.checking(Some(&bet)),
        "INV-RESOURCE-ANSWER-HAS-AN-OWNER: alef's answer ended or filled bet's check"
    );
    up.check_ended(&bet, CheckEnd::Offers(no_offers()));
    assert!(up.offers_for(Some(&bet)).is_some() && !up.checking(Some(&bet)));
    assert!(
        up.offers_for(Some(&open("bet", 3))).is_none(),
        "INV-RESOURCE-ANSWER-HAS-AN-OWNER: an answer from before the reopening is shown"
    );
}

#[test]
fn a_second_check_is_not_sent_while_one_is_out_for_this_open() {
    let alef = open("alef", 1);
    let mut up = UpgradeState::default();
    assert!(up.check_started(alef.clone()));
    assert!(
        !up.check_started(alef.clone()),
        "INV-BUSY-ENDS-WITH-ITS-WORK: a second check is sent while one is out"
    );
    up.check_ended(&alef, CheckEnd::Nothing);
    assert!(
        !up.checking(Some(&alef))
            && up.offers_for(Some(&alef)).is_none()
            && up.check_error(Some(&alef)).is_none(),
        "INV-BUSY-ENDS-WITH-ITS-WORK: a check with nothing to show stays busy or shows something"
    );
    assert!(
        up.check_started(alef.clone()),
        "INV-BUSY-ENDS-WITH-ITS-WORK: an ended check keeps the next from starting"
    );
    up.check_ended(&alef, CheckEnd::Failed("no".into()));
    assert!(!up.checking(Some(&alef)));
    assert_eq!(up.check_error(Some(&alef)).as_deref(), Some("no"));
}

#[test]
fn a_failed_check_is_said_only_in_the_open_it_was_made_for() {
    let (alef, again) = (open("alef", 1), open("alef", 2));
    let mut up = UpgradeState::default();
    up.check_started(alef.clone());
    up.check_ended(&alef, CheckEnd::Failed("no".into()));
    assert!(
        up.check_error(Some(&again)).is_none() && up.check_error(None).is_none(),
        "INV-RESOURCE-ANSWER-HAS-AN-OWNER: a failed check is said in another open or on Home"
    );
    up.check_started(alef.clone());
    up.check_ended(
        &alef,
        CheckEnd::Offers(UpdatesView {
            texts_error: Some(tc_api::refusal::UpdateCheckFailure::Unreachable),
            ..no_offers()
        }),
    );
    assert!(up.check_error(Some(&alef)).is_some());
    assert!(
        up.check_error(Some(&again)).is_none(),
        "INV-RESOURCE-ANSWER-HAS-AN-OWNER: the texts Door43 could not answer for are said in another open"
    );
}

/// What a person and Door43 can do to Check for updates.
#[derive(Debug, Clone)]
enum CheckStep {
    /// A project opens: a new open is on screen.
    Open,
    /// Home: no open is on screen.
    Home,
    Press,
    /// The `n`th call still out is answered.
    Answer(usize, AnswerKind),
}

#[derive(Debug, Clone, Copy)]
enum AnswerKind {
    Offers,
    Failed,
    Nothing,
}

fn arb_check_step() -> impl Strategy<Value = CheckStep> {
    let kind = prop_oneof![
        Just(AnswerKind::Offers),
        Just(AnswerKind::Failed),
        Just(AnswerKind::Nothing)
    ];
    prop_oneof![
        Just(CheckStep::Open),
        Just(CheckStep::Home),
        Just(CheckStep::Press),
        (0..4usize, kind).prop_map(|(n, kind)| CheckStep::Answer(n, kind)),
    ]
}

/// A view that names the call it answers, in its one set's language.
fn offers_of(call: usize) -> UpdatesView {
    UpdatesView {
        sets: vec![SetOffer {
            rung: SetRung::Primary,
            language: call.to_string(),
            moves: Vec::new(),
        }],
        texts: Vec::new(),
        texts_error: None,
    }
}

proptest! {
    /// INV-BUSY-ENDS-WITH-ITS-WORK and INV-RESOURCE-ANSWER-HAS-AN-OWNER over any order of
    /// opens, leaves, presses and answers: the button is busy exactly while a check for the
    /// open on screen is out, one check at most is out per open, and the offers on screen came
    /// from a call made for the open on screen.
    #[test]
    fn check_for_updates_is_busy_only_for_its_own_open_on_every_sequence(
        steps in proptest::collection::vec(arb_check_step(), 0..60),
    ) {
        let mut up = UpgradeState::default();
        let mut epoch = 0;
        let mut here: Option<Scope> = None;
        // Every call sent, by number, and the numbers still out.
        let mut calls: Vec<Scope> = Vec::new();
        let mut out: Vec<usize> = Vec::new();
        for step in steps {
            match step {
                CheckStep::Open => {
                    epoch += 1;
                    here = Some(open("alef", epoch));
                }
                CheckStep::Home => here = None,
                CheckStep::Press => {
                    if let Some(at) = &here {
                        let was_out = out.iter().any(|n| &calls[*n] == at);
                        let sent = up.check_started(at.clone());
                        prop_assert_eq!(
                            sent, !was_out,
                            "INV-BUSY-ENDS-WITH-ITS-WORK: a press sent {} with a check out {}", sent, was_out
                        );
                        if sent {
                            out.push(calls.len());
                            calls.push(at.clone());
                        }
                    }
                }
                CheckStep::Answer(n, kind) => {
                    if !out.is_empty() {
                        let call = out.remove(n % out.len());
                        let end = match kind {
                            AnswerKind::Offers => CheckEnd::Offers(offers_of(call)),
                            AnswerKind::Failed => CheckEnd::Failed(call.to_string()),
                            AnswerKind::Nothing => CheckEnd::Nothing,
                        };
                        up.check_ended(&calls[call], end);
                    }
                }
            }
            let busy = up.checking(here.as_ref());
            let is_out = here.as_ref().is_some_and(|at| out.iter().any(|n| &calls[*n] == at));
            prop_assert_eq!(
                busy, is_out,
                "INV-BUSY-ENDS-WITH-ITS-WORK: busy {} with a check out for this open {}", busy, is_out
            );
            if let Some(Ok(call)) = up.check_error(here.as_ref()).map(|said| said.parse::<usize>()) {
                prop_assert_eq!(
                    Some(&calls[call]), here.as_ref(),
                    "INV-RESOURCE-ANSWER-HAS-AN-OWNER: the failure on screen is another open's"
                );
            }
            if let Some(offers) = up.offers_for(here.as_ref()) {
                let call: usize = offers.view.sets[0].language.parse().unwrap();
                prop_assert_eq!(
                    Some(&calls[call]), here.as_ref(),
                    "INV-RESOURCE-ANSWER-HAS-AN-OWNER: the offers on screen answer another open's call"
                );
            }
        }
    }
}

#[test]
fn a_text_that_door43_could_not_answer_for_is_said_beside_the_set_offers() {
    let alef = open("alef", 1);
    let mut up = UpgradeState::default();
    up.check_started(alef.clone());
    let view = UpdatesView {
        sets: vec![SetOffer {
            rung: SetRung::Primary,
            language: "es-419".into(),
            moves: vec![change("es-419_tn")],
        }],
        texts: Vec::new(),
        texts_error: Some(tc_api::refusal::UpdateCheckFailure::Unreachable),
    };
    up.check_ended(&alef, CheckEnd::Offers(view));
    assert_eq!(
        up.check_error(Some(&alef)).as_deref(),
        Some(
            "Could not check for updates: Door43 cannot be reached. Check the connection and try again."
        )
    );
    assert_eq!(
        up.offers_for(Some(&alef)).unwrap().view.sets.len(),
        1,
        "the set offers stand"
    );
}

#[test]
fn a_download_that_fails_leaves_the_error_and_no_confirmation() {
    let mut up = UpgradeState::default();
    up.install_started(Installing::Set(SetRung::Primary));
    up.install_progress("es-419_tn".into());
    assert_eq!(up.progress.as_deref(), Some("es-419_tn"));
    up.install_failed(Some("the upgrade was not applied: no route".into()));
    assert!(up.installing.is_none() && up.progress.is_none() && up.preview.is_none());
    assert!(up.error.is_some());
    // A cancelled download is no error.
    up.install_started(Installing::Text("el-x-koine_ugnt".into()));
    assert!(up.error.is_none(), "a new try clears the old error");
    up.install_failed(None);
    assert!(up.error.is_none());
}

#[test]
fn confirming_sends_one_request_and_a_blocked_plan_is_never_sent() {
    let mut up = UpgradeState::default();
    up.plan_ready(set_plan(1, Vec::new()));
    assert!(up.confirm_started());
    assert!(!up.confirm_started(), "a second press waits for the first");
    up.cancel();
    assert!(
        up.preview.is_some(),
        "the dialog cannot be closed under a save"
    );
    up.apply_failed("The disk is full.".into());
    assert!(up.confirm_started(), "after a failure Confirm tries again");

    let blocked = plan(
        2,
        PlanWhat::Set {
            rung: SetRung::Fallback,
            language: "en".into(),
            moves: Vec::new(),
        },
        Vec::new(),
        vec![BlockedUnit {
            tool: Tool::TranslationWords,
            unit: CheckCollection::Book(BookId::Titus),
            reason: BlockReason::NoResource,
        }],
    );
    let mut up = UpgradeState::default();
    up.plan_ready(blocked);
    assert!(!up.confirm_started());
}

#[test]
fn a_failed_save_holds_the_preview_with_its_reason() {
    let mut up = UpgradeState::default();
    up.plan_ready(set_plan(
        1,
        vec![row(Tool::TranslationWords, BookId::Titus, 2, Some((2, 0)))],
    ));
    assert!(up.confirm_started());
    up.apply_failed("The change was not saved: the disk is full.".into());
    let preview = up.preview.as_ref().unwrap();
    assert!(!preview.applying);
    assert_eq!(
        preview.plan.plan,
        PlanId::new(1),
        "the same plan stays for the retry"
    );
    assert!(up.error.is_some());
    up.cancel();
    assert!(up.preview.is_none() && up.error.is_none());
}

#[test]
fn a_stale_confirm_replaces_the_plan_shown_with_the_one_made_again() {
    // tC4 #595: the person reads the new figures before anything is written.
    let mut up = UpgradeState::default();
    up.plan_ready(set_plan(
        1,
        vec![row(Tool::TranslationWords, BookId::Titus, 2, Some((2, 0)))],
    ));
    assert!(up.confirm_started());
    up.replanned(set_plan(
        2,
        vec![row(Tool::TranslationWords, BookId::Titus, 2, Some((1, 1)))],
    ));
    let preview = up.preview.as_ref().unwrap();
    assert_eq!(preview.plan.plan, PlanId::new(2));
    assert!(!preview.applying, "it waits for the person's own confirm");

    let mut gw = GatewayState::default();
    assert!(gw.asking());
    gw.planned(package(), set_plan(1, Vec::new()));
    assert!(gw.confirm_started());
    gw.replanned(set_plan(2, Vec::new()));
    assert!(!gw.busy);
    match &gw.preview {
        Some(GatewayPreview::Plan { plan, .. }) => assert_eq!(plan.plan, PlanId::new(2)),
        other => panic!("{other:?}"),
    }
}

#[test]
fn a_set_that_was_upgraded_is_current_and_a_text_that_was_upgraded_is_not_offered_again() {
    let mut up = UpgradeState::default();
    let view = UpdatesView {
        sets: vec![SetOffer {
            rung: SetRung::Primary,
            language: "es-419".into(),
            moves: vec![change("es-419_twl")],
        }],
        texts: vec![TextOffer {
            kind: TextKind::Original,
            change: change("el-x-koine_ugnt"),
        }],
        texts_error: None,
    };
    let alef = open("alef", 1);
    up.check_started(alef.clone());
    up.check_ended(&alef, CheckEnd::Offers(view));
    up.plan_ready(set_plan(1, Vec::new()));
    up.applied();
    let offers = up.offers_for(Some(&alef)).unwrap().clone();
    assert!(
        offers.view.sets[0].moves.is_empty(),
        "the set is up to date"
    );
    assert_eq!(offers.view.texts.len(), 1, "the other offers stand");
    up.plan_ready(plan(
        3,
        PlanWhat::Text {
            kind: TextKind::Original,
            change: change("el-x-koine_ugnt"),
        },
        Vec::new(),
        Vec::new(),
    ));
    up.applied();
    assert!(up.offers_for(Some(&alef)).unwrap().view.texts.is_empty());
    assert!(up.preview.is_none());
}

#[test]
fn a_second_choice_of_a_language_does_nothing_while_one_is_previewed_or_under_way() {
    // tC4 #580, interruptions 1 to 3.
    let mut gw = GatewayState::default();
    assert!(gw.asking());
    assert!(!gw.asking(), "under way");
    gw.planned(package(), set_plan(1, Vec::new()));
    assert!(!gw.asking(), "previewed");
    assert!(gw.confirm_started());
    gw.cancel();
    assert!(
        gw.preview.is_some(),
        "a change that was confirmed cannot be cancelled"
    );
    gw.apply_failed("The disk is full.".into());
    assert_eq!(gw.error.as_deref(), Some("The disk is full."));
    assert!(
        gw.preview.is_some(),
        "the dialog holds the preview after a failed save"
    );
    gw.cancel();
    assert!(gw.preview.is_none() && gw.error.is_none());
    assert!(gw.asking());
}

#[test]
fn a_plan_that_could_not_be_made_shows_its_error_and_never_a_change_button() {
    let mut gw = GatewayState::default();
    assert!(gw.asking());
    gw.plan_failed(package(), "es-419_tn: it is not installed".into());
    assert!(matches!(gw.preview, Some(GatewayPreview::Failed { .. })));
    assert!(
        !gw.confirm_started(),
        "a failed read is never mistaken for success"
    );
    assert!(!gw.busy);
}

#[test]
fn the_gateway_headline_names_the_books_and_counts_as_tc4_does() {
    let titus = row(Tool::TranslationWords, BookId::Titus, 2, Some((2, 0)));
    let notes = row(Tool::TranslationNotes, BookId::Titus, 1, Some((0, 1)));
    let (headline, detail) = gateway_headline(&set_plan(1, vec![titus.clone(), notes]));
    assert_eq!(
        headline,
        "3 decisions in Titus were made against the notes you are leaving."
    );
    assert!(
        detail
            .unwrap()
            .starts_with("Decisions that match a check in the new notes carry over.")
    );
    let (one, _) = gateway_headline(&set_plan(
        1,
        vec![row(Tool::TranslationNotes, BookId::Jonah, 1, None)],
    ));
    assert_eq!(
        one,
        "1 decision in Jonah were made against the notes you are leaving."
    );
    let many: Vec<PlanRow> = [
        BookId::Genesis,
        BookId::Exodus,
        BookId::Leviticus,
        BookId::Numbers,
        BookId::Ruth,
    ]
    .into_iter()
    .map(|b| row(Tool::TranslationNotes, b, 1, None))
    .collect();
    assert_eq!(
        gateway_headline(&set_plan(1, many)).0,
        "5 decisions in Genesis, Exodus, Leviticus and 2 more were made against the notes you are leaving."
    );
    let (harmless, none) = gateway_headline(&set_plan(1, Vec::new()));
    assert_eq!(
        harmless,
        "Nothing you have already checked will be affected."
    );
    assert!(none.is_none());
}

fn french(owner: &str) -> GatewayPackage {
    GatewayPackage {
        gateway: GatewayRef {
            language: "fr".into(),
            owner: owner.into(),
        },
        name: "French".into(),
        autonym: "Français".into(),
        ..package()
    }
}

fn gateway_plan(from: Option<GatewayPackage>, to: &GatewayPackage) -> PlanView {
    plan(
        1,
        PlanWhat::Gateway(Box::new(GatewayChange {
            from,
            to: to.clone(),
            images: None,
        })),
        Vec::new(),
        Vec::new(),
    )
}

/// #855: two packages of one language (fr from Xenizo and from MVHS) share an autonym, so
/// Keep and Change name the owner too, or both would read "Français".
#[test]
fn keep_and_change_name_two_different_packages() {
    let (xenizo, mvhs) = (french("Xenizo"), french("MVHS"));
    assert_eq!(
        gateway_buttons(Some(&xenizo), &mvhs),
        (
            "Keep Français · Xenizo".to_owned(),
            "Change to Français · MVHS".to_owned()
        )
    );
    let english = package();
    assert_eq!(
        gateway_buttons(Some(&mvhs), &english),
        ("Keep Français".to_owned(), "Change to English".to_owned()),
        "two languages are named by their autonyms alone"
    );
    assert_eq!(gateway_buttons(None, &english).1, "Change to English");
}

/// #855: a plan for the package the project already checks against is never asked, from any
/// entry point; the owner's letter case does not make it another package.
#[test]
fn the_language_in_use_is_never_asked() {
    let english = package();
    let in_use = GatewayPackage {
        gateway: GatewayRef {
            owner: "UNFOLDINGWORD".into(),
            ..english.gateway.clone()
        },
        ..english.clone()
    };
    let mut gw = GatewayState::default();
    assert!(gw.asking());
    gw.planned(english.clone(), gateway_plan(Some(in_use), &english));
    assert_eq!(
        gw,
        GatewayState::default(),
        "nothing is shown and nothing waits"
    );
    assert!(gw.asking(), "another language can be chosen next");
    gw.planned(
        english.clone(),
        gateway_plan(Some(french("MVHS")), &english),
    );
    assert!(matches!(gw.preview, Some(GatewayPreview::Plan { .. })));
}

#[test]
fn a_row_says_what_carried_over_or_how_many_decisions_it_was_checked_against() {
    assert_eq!(
        row_text(&row(Tool::TranslationWords, BookId::Titus, 2, Some((2, 0)))),
        "Titus · Translation Words: 2 carried over, 0 to check again"
    );
    assert_eq!(
        row_text(&row(Tool::TranslationNotes, BookId::Titus, 4, None)),
        "Titus · Translation Notes — 4 decision(s) checked against es-419_twl"
    );
}

#[test]
fn the_blocked_callout_gives_the_remedy_of_the_first_reason() {
    let unit = |reason| BlockedUnit {
        tool: Tool::TranslationNotes,
        unit: CheckCollection::Book(BookId::Titus),
        reason,
    };
    assert_eq!(
        blocked_text(&[unit(BlockReason::NoResource)]),
        "This change cannot be applied: Titus (Translation Notes) already carry checking \
         decisions, and the new language does not cover them. Install a suite that covers \
         these books first. Nothing was changed."
    );
    let text = blocked_text(&[
        unit(BlockReason::NoResource),
        unit(BlockReason::VersificationUnknown),
    ]);
    assert!(
        text.contains("versification scheme could not be identified"),
        "{text}"
    );
}

#[test]
fn a_text_upgrade_says_how_many_verses_it_marks_or_that_nothing_changes() {
    assert_eq!(
        text_headline(TextKind::Original, Some(12)),
        (
            "The alignments of 12 verse(s) will be marked invalid.".to_owned(),
            true
        )
    );
    assert_eq!(
        text_headline(TextKind::Original, Some(0)),
        ("No alignment will change.".to_owned(), false)
    );
    assert_eq!(
        text_headline(TextKind::Gateway, None).0,
        "No alignment and no check decision will change. The source pane will show the new text."
    );
}
