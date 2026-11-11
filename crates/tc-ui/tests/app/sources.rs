//! Project settings' and Get source texts' forms (B9a): tC4's `test/settingsOpen.test.ts`
//! cases that one server read leaves (#641: a reply lands only on its own project's form, a
//! failed read keeps Save disabled), and the rows of a package.

use proptest::prelude::*;
use tc_api::home::{BookTileView, Door43Card, HomeCard, ProjectKind};
use tc_api::ids::{Epoch, JobId, ProjectRef, RequestId, Scope};
use tc_api::resources::{
    Downloaded, FromInstalls, GatewayPackage, GatewayRef, PackageRole, PackageRow, Seen,
    SourcesView,
};
use tc_api::settings::{CurrentGateway, GatewayCard, SettingsView};
use tc_api::shown::{Direction, Known};
use tc_core::BookId;
use tc_ui::app::sources::{Dl, DlEnd, GatewayState, SettingsForm, SourcesForm};

fn card(project: &str, books: &[BookId]) -> HomeCard {
    HomeCard {
        project: ProjectRef::parse(project).unwrap(),
        name: format!("{project} name"),
        tag: Known::Known("ar".into()),
        dir: Direction::Ltr,
        kind: ProjectKind::Bible,
        door43: Door43Card::Local,
        books: Known::Known(
            books
                .iter()
                .map(|book| BookTileView {
                    book: *book,
                    drafted: Known::Unknown,
                    conflicts: 0,
                })
                .collect(),
        ),
        stories: None,
        conflicts: Known::Unknown,
    }
}

fn gateway(language: &str, owner: &str) -> GatewayRef {
    GatewayRef {
        language: language.into(),
        owner: owner.into(),
    }
}

fn view() -> SettingsView {
    SettingsView {
        language_name: "العربية".into(),
        direction: Direction::Rtl,
        font: Some("Scheherazade New — Arabic script".into()),
        gateway: GatewayCard {
            current: Some(CurrentGateway {
                gateway: gateway("ar", "BSOJ"),
                autonym: "العربية".into(),
            }),
            options: FromInstalls::Listed(Vec::new()),
        },
    }
}

#[test]
fn settings_open_with_the_cards_facts_and_save_waits_for_the_read() {
    let mut st = SettingsForm::of(&card("alef", &[BookId::Titus]));
    assert_eq!((st.name.as_str(), st.code.as_str()), ("alef name", "ar"));
    assert_eq!(st.font, "Noto Sans (default)");
    assert!(st.one_book());
    assert_eq!(st.gateway, GatewayState::Loading);
    assert!(
        st.save_disabled(),
        "the defaults are never saved over the project's values"
    );
    let alef = st.project.clone();
    st.read(&alef, view());
    assert!(!st.save_disabled());
    assert_eq!(st.dir, Direction::Rtl);
    assert_eq!(st.font, "Scheherazade New — Arabic script");
    assert_eq!(st.lang_name, "العربية");
    assert!(matches!(st.gateway, GatewayState::Read(_)));
}

#[test]
fn a_reply_for_another_projects_settings_changes_nothing() {
    // settingsOpen 5 and 6: Settings closed, or another project's opened, before the read came.
    let mut st = SettingsForm::of(&card("bet", &[BookId::Titus, BookId::Jonah]));
    let before = st.clone();
    let alef = ProjectRef::parse("alef").unwrap();
    st.read(&alef, view());
    st.failed(&alef, "gone".into());
    assert_eq!(st, before);
    assert!(!st.one_book());
}

#[test]
fn a_failed_read_keeps_save_disabled_and_states_why() {
    // settingsOpen 4 and 7: the reason shows, Save stays disabled, the card leaves its
    // loading text.
    let mut st = SettingsForm::of(&card("alef", &[BookId::Titus]));
    let alef = st.project.clone();
    st.failed(&alef, "settings.json: the file is held".into());
    assert!(st.save_disabled());
    assert_eq!(st.error.as_deref(), Some("settings.json: the file is held"));
    assert_eq!(st.gateway, GatewayState::Failed);
}

fn package(language: &str, owner: &str) -> GatewayPackage {
    GatewayPackage {
        gateway: gateway(language, owner),
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

fn row(role: PackageRole, repo: &str) -> PackageRow {
    PackageRow {
        role,
        repo: repo.into(),
        desc: String::new(),
    }
}

#[test]
fn the_text_is_always_included_and_helps_can_be_left_out() {
    let mut src = SourcesForm::default();
    let en = package("en", "unfoldingWord");
    src.pick(en.clone());
    let rows = vec![
        row(PackageRole::Text, "en_ult"),
        row(PackageRole::Notes, "en_tn"),
    ];
    src.rows_read(&en, BookId::Titus, rows.clone());
    assert!(src.can_download(Some(&open(1))));
    assert!(!src.can_download(None), "no project, no download");
    src.toggle(&rows[0]);
    src.toggle(&rows[1]);
    assert_eq!(src.chosen(), ["en_ult"]);
    src.toggle(&rows[1]);
    assert_eq!(src.chosen(), ["en_ult", "en_tn"]);
}

#[test]
fn rows_for_a_package_or_book_left_meanwhile_are_not_shown() {
    let mut src = SourcesForm::default();
    let (en, es) = (
        package("en", "unfoldingWord"),
        package("es-419", "es-419_gl"),
    );
    src.pick(en.clone());
    src.pick(es.clone());
    src.rows_read(&en, BookId::Titus, vec![row(PackageRole::Notes, "en_tn")]);
    assert!(src.loading && src.rows.is_empty());
    src.set_book(BookId::Jonah);
    src.rows_failed(&es, BookId::Titus, "late".into());
    assert_eq!(src.error, None);
    src.rows_read(
        &es,
        BookId::Jonah,
        vec![row(PackageRole::Notes, "es-419_tn")],
    );
    assert!(!src.loading);
    assert_eq!(src.chosen(), ["es-419_tn"]);
    src.change_gateway();
    assert_eq!(src.gateway, None);
    assert!(src.rows.is_empty());
}

#[test]
fn the_current_package_compares_its_owner_without_letter_case() {
    let (alef, bet) = (open(1), open(2));
    let mut src = SourcesForm::default();
    src.packages_read(
        alef.clone(),
        SourcesView {
            gateways: Vec::new(),
            current: Some(gateway("es-419", "ES-419_GL")),
            checkable: FromInstalls::Listed(vec![gateway("en", "unfoldingWord")]),
            pinned: true,
        },
    );
    assert!(src.is_current(Some(&alef), &package("es-419", "es-419_gl")));
    assert!(!src.is_current(Some(&alef), &package("en", "unfoldingWord")));
    assert!(src.is_checkable(Some(&alef), &package("en", "unfoldingWord")));
    // Another open, and Home, never read alef's packages as their own.
    for other in [Some(&bet), None] {
        assert!(
            src.packages(other).is_none()
                && !src.is_current(other, &package("es-419", "es-419_gl"))
                && !src.is_checkable(other, &package("en", "unfoldingWord")),
            "INV-RESOURCE-ANSWER-HAS-AN-OWNER: one open's packages are shown for another"
        );
    }
    src.not_read();
    assert!(src.needs_internet);
}

fn rid(n: u8) -> RequestId {
    RequestId::from_bytes([n; 16])
}

/// One open of the project: the same project opened again has another epoch.
fn open(epoch: u64) -> Scope {
    Scope {
        project: ProjectRef::parse("alef").unwrap(),
        epoch: Epoch::new(epoch),
    }
}

/// Step 2 on English with the rows of `book` read.
fn on_book(src: &mut SourcesForm, book: BookId) {
    let en = package("en", "unfoldingWord");
    if src.gateway.as_ref() != Some(&en) {
        src.pick(en.clone());
    }
    src.set_book(book);
    src.rows_read(
        &en,
        book,
        vec![
            row(PackageRole::Text, "en_ult"),
            row(PackageRole::Notes, "en_tn"),
        ],
    );
}

#[test]
fn a_download_keeps_its_cancel_and_names_what_it_fetched_whatever_is_chosen_meanwhile() {
    let here = open(1);
    let mut src = SourcesForm::default();
    on_book(&mut src, BookId::Hebrews);
    let (request, what) = src.download_pressed(&here, rid(1)).unwrap();
    assert!(
        src.download_pressed(&here, rid(2)).is_none() && !src.can_download(Some(&here)),
        "INV-BUSY-ENDS-WITH-ITS-WORK: a second press before the job starts another download"
    );
    src.download_started(request, JobId::new(7));
    // Another book, a row left out, back to step 1, another open of the project.
    on_book(&mut src, BookId::Titus);
    src.toggle(&row(PackageRole::Notes, "en_tn"));
    src.change_gateway();
    for at in [Some(&here), Some(&open(2)), None] {
        assert!(
            src.downloading() && !src.can_download(at),
            "INV-BUSY-ENDS-WITH-ITS-WORK: a running download lost its Cancel or offers Download"
        );
    }
    assert!(matches!(src.dl(), Dl::Running { job, .. } if *job == JobId::new(7)));
    on_book(&mut src, BookId::Titus);
    src.download_ended(JobId::new(7), DlEnd::Done(Downloaded::Fetched));
    assert_eq!(
        *src.dl(),
        Dl::Finished {
            what: what.clone(),
            outcome: Downloaded::Fetched
        },
        "INV-DOWNLOAD-NAMES-WHAT-IT-FETCHED: the finished download names another selection"
    );
    assert_eq!(what.book, BookId::Hebrews);
    assert!(
        src.can_download(Some(&here)),
        "Titus was not downloaded: it is offered"
    );
}

#[test]
fn what_just_finished_is_not_offered_again_in_its_open_until_the_person_chooses_again() {
    let here = open(1);
    let mut src = SourcesForm::default();
    on_book(&mut src, BookId::Titus);
    let (request, _) = src.download_pressed(&here, rid(1)).unwrap();
    src.download_started(request, JobId::new(1));
    src.download_ended(JobId::new(1), DlEnd::Done(Downloaded::AlreadyHere));
    assert!(!src.can_download(Some(&here)));
    assert!(
        src.can_download(Some(&open(2))),
        "a download fetches at its own project's pins: another open is offered it"
    );
    src.toggle(&row(PackageRole::Notes, "en_tn"));
    assert!(
        *src.dl() == Dl::Idle && src.can_download(Some(&here)),
        "a choice takes the finished line away and offers Download"
    );
}

#[test]
fn a_lost_answer_is_asked_again_as_the_same_request_only_for_the_same_selection() {
    let here = open(1);
    let mut src = SourcesForm::default();
    on_book(&mut src, BookId::Titus);
    let (request, _) = src.download_pressed(&here, rid(1)).unwrap();
    src.download_unanswered(request, Some("no answer".into()));
    assert!(!src.downloading());
    assert_eq!(src.error.as_deref(), Some("no answer"));
    let (again, _) = src.download_pressed(&here, rid(2)).unwrap();
    assert_eq!(
        again,
        rid(1),
        "INV-ONE-REQUEST-PER-ATTEMPT: the retry was sent as another request"
    );
    src.download_unanswered(again, None);
    on_book(&mut src, BookId::Hebrews);
    let (other, _) = src.download_pressed(&here, rid(3)).unwrap();
    assert_eq!(other, rid(3), "another selection is another request");
    // A refusal ends the attempt: the next press is a new request.
    src.download_refused(other, Some("refused".into()));
    assert_eq!(src.error.as_deref(), Some("refused"));
    assert_eq!(src.download_pressed(&here, rid(4)).unwrap().0, rid(4));
}

#[test]
fn a_download_that_is_not_sent_or_fails_is_under_way_no_more() {
    let here = open(1);
    let mut src = SourcesForm::default();
    on_book(&mut src, BookId::Titus);
    src.download_pressed(&here, rid(1)).unwrap();
    src.download_not_sent();
    assert!(!src.downloading() && src.can_download(Some(&here)));
    let (request, _) = src.download_pressed(&here, rid(2)).unwrap();
    src.download_asked_again(request, rid(3));
    assert_eq!(src.starting().unwrap().0, rid(3));
    src.download_started(rid(3), JobId::new(1));
    // The person moved to another book: the failure of the Titus download is not said there.
    on_book(&mut src, BookId::Hebrews);
    src.download_failed(JobId::new(1), rid(9));
    src.download_refused(rid(9), Some("no route".into()));
    assert!(
        !src.downloading() && src.error.is_none(),
        "INV-RESOURCE-ANSWER-HAS-AN-OWNER: a failure is said for another book"
    );
    let (request, _) = src.download_pressed(&here, rid(4)).unwrap();
    src.download_started(request, JobId::new(2));
    src.download_ended(JobId::new(9), DlEnd::Stopped);
    assert!(src.downloading(), "another job's end changes nothing");
    // The job failed for the internet: its selection waits for the question, and a question
    // that is dropped leaves nothing waiting.
    src.download_failed(JobId::new(2), rid(5));
    assert_eq!(src.starting().unwrap().0, rid(5));
    src.download_not_sent();
    assert_eq!(
        *src.dl(),
        Dl::Idle,
        "INV-BUSY-ENDS-WITH-ITS-WORK: a dropped question leaves the download waiting"
    );
}

/// What a person and the server can do to the download.
#[derive(Debug, Clone)]
enum DlStep {
    /// A project opens: a new open is on screen.
    Open,
    Home,
    Book(bool),
    Toggle,
    StepOne,
    Press,
    Start(StartKind),
    End(EndKind),
}

#[derive(Debug, Clone, Copy)]
enum StartKind {
    Job,
    Refused,
    Unanswered,
    AskedAgain,
    NotNow,
}

#[derive(Debug, Clone, Copy)]
enum EndKind {
    Done,
    Stopped,
    Failed,
    AskedAgain,
    DroppedQuestion,
}

fn arb_dl_step() -> impl Strategy<Value = DlStep> {
    let start = prop_oneof![
        Just(StartKind::Job),
        Just(StartKind::Refused),
        Just(StartKind::Unanswered),
        Just(StartKind::AskedAgain),
        Just(StartKind::NotNow)
    ];
    let end = prop_oneof![
        Just(EndKind::Done),
        Just(EndKind::Stopped),
        Just(EndKind::Failed),
        Just(EndKind::AskedAgain),
        Just(EndKind::DroppedQuestion)
    ];
    prop_oneof![
        Just(DlStep::Open),
        Just(DlStep::Home),
        any::<bool>().prop_map(DlStep::Book),
        Just(DlStep::Toggle),
        Just(DlStep::StepOne),
        Just(DlStep::Press),
        start.prop_map(DlStep::Start),
        end.prop_map(DlStep::End),
    ]
}

proptest! {
    /// INV-BUSY-ENDS-WITH-ITS-WORK and INV-DOWNLOAD-NAMES-WHAT-IT-FETCHED over any order of
    /// opens, leaves, choices, presses and answers: the download is under way exactly from an
    /// accepted press to its end, one at most, nothing the person chooses meanwhile changes
    /// it, and what finished is named by the selection of its own press.
    #[test]
    fn a_download_is_under_way_from_its_press_to_its_end_on_every_sequence(
        steps in proptest::collection::vec(arb_dl_step(), 0..80),
    ) {
        let mut src = SourcesForm::default();
        let mut epoch = 0;
        let mut here: Option<Scope> = None;
        let mut next = 0u8;
        // The model: the selection of the accepted press, and the job once the server gave one.
        let mut pressed: Option<tc_ui::app::sources::Selection> = None;
        let mut request: Option<RequestId> = None;
        let mut job: Option<JobId> = None;
        for step in steps {
            match step {
                DlStep::Open => {
                    epoch += 1;
                    here = Some(open(epoch));
                }
                DlStep::Home => here = None,
                DlStep::Book(titus) => on_book(&mut src, if titus { BookId::Titus } else { BookId::Hebrews }),
                DlStep::Toggle => src.toggle(&row(PackageRole::Notes, "en_tn")),
                DlStep::StepOne => src.change_gateway(),
                DlStep::Press => {
                    if let Some(at) = &here {
                        next += 1;
                        let taken = src.download_pressed(at, rid(next));
                        if pressed.is_some() {
                            prop_assert!(taken.is_none(), "INV-BUSY-ENDS-WITH-ITS-WORK: a second download started");
                        }
                        if let Some((sent, what)) = taken {
                            prop_assert_eq!(&what.at, at);
                            prop_assert_eq!(what.book, src.book);
                            prop_assert_eq!(&what.repos, &src.chosen());
                            pressed = Some(what);
                            request = Some(sent);
                        }
                    }
                }
                DlStep::Start(kind) => {
                    if let (Some(sent), None) = (request, job) {
                        match kind {
                            StartKind::Job => {
                                job = Some(JobId::new(u64::from(next)));
                                src.download_started(sent, JobId::new(u64::from(next)));
                            }
                            StartKind::Refused => {
                                src.download_refused(sent, Some("refused".into()));
                                (pressed, request) = (None, None);
                            }
                            StartKind::Unanswered => {
                                src.download_unanswered(sent, Some("lost".into()));
                                (pressed, request) = (None, None);
                            }
                            StartKind::AskedAgain => {
                                next += 1;
                                src.download_asked_again(sent, rid(next));
                                request = Some(rid(next));
                            }
                            StartKind::NotNow => {
                                src.download_not_sent();
                                (pressed, request) = (None, None);
                            }
                        }
                    }
                }
                DlStep::End(kind) => {
                    if let Some(running) = job.take() {
                        let what = pressed.take().unwrap();
                        request = None;
                        match kind {
                            EndKind::Done => {
                                src.download_ended(running, DlEnd::Done(Downloaded::Fetched));
                                prop_assert_eq!(
                                    src.dl(),
                                    &Dl::Finished { what, outcome: Downloaded::Fetched },
                                    "INV-DOWNLOAD-NAMES-WHAT-IT-FETCHED: the finished download names another selection"
                                );
                            }
                            EndKind::Stopped => src.download_ended(running, DlEnd::Stopped),
                            EndKind::Failed => {
                                next += 1;
                                src.download_failed(running, rid(next));
                                src.download_refused(rid(next), Some("no".into()));
                            }
                            // The internet question: asked, so the selection waits, or dropped.
                            EndKind::AskedAgain => {
                                next += 1;
                                src.download_failed(running, rid(next));
                                pressed = Some(what);
                                request = Some(rid(next));
                            }
                            EndKind::DroppedQuestion => {
                                next += 1;
                                src.download_failed(running, rid(next));
                                src.download_not_sent();
                            }
                        }
                    }
                }
            }
            prop_assert_eq!(
                src.downloading(), pressed.is_some(),
                "INV-BUSY-ENDS-WITH-ITS-WORK: under way {} with a download pressed and not ended {}",
                src.downloading(), pressed.is_some()
            );
            prop_assert_eq!(
                matches!(src.dl(), Dl::Running { .. }), job.is_some(),
                "INV-BUSY-ENDS-WITH-ITS-WORK: Cancel is offered {} with a job running {}",
                matches!(src.dl(), Dl::Running { .. }), job.is_some()
            );
            if pressed.is_some() {
                prop_assert!(
                    !src.can_download(here.as_ref()),
                    "INV-BUSY-ENDS-WITH-ITS-WORK: Download is offered while one is under way"
                );
            }
            match src.dl() {
                Dl::Starting { what, .. } | Dl::Running { what, .. } => {
                    prop_assert_eq!(Some(what), pressed.as_ref(), "INV-DOWNLOAD-NAMES-WHAT-IT-FETCHED: the download under way changed its selection");
                }
                Dl::Idle | Dl::Finished { .. } | Dl::Unanswered { .. } => {}
            }
        }
    }
}

/// tC4 `saveSettings` and AD14: Save is for the values the dialog showed, sends the direction
/// and font chosen, waits for its answer, and a lost reply is retried as the same request.
#[test]
fn save_sends_what_was_shown_and_what_was_chosen_once() {
    let mut st = SettingsForm::of(&card("alef", &[BookId::Titus]));
    assert_eq!(st.press_save(|| rid(1)), None, "before the values came");
    let alef = st.project.clone();
    st.read(&alef, view());
    st.dir = Direction::Ltr;
    st.font = "Charis SIL".into();
    st.edited();
    let save = st.press_save(|| rid(1)).unwrap();
    assert_eq!(save.request, rid(1));
    assert_eq!(save.shown.direction, Direction::Rtl);
    assert_eq!(
        save.shown.font.as_deref(),
        Some("Scheherazade New — Arabic script")
    );
    assert_eq!(
        (save.direction, save.font.as_str()),
        (Direction::Ltr, "Charis SIL")
    );
    assert_eq!(st.press_save(|| rid(2)), None, "disabled while it runs");
    st.lost(&alef, "the server did not answer".into());
    assert_eq!(
        st.press_save(|| rid(3)).unwrap().request,
        rid(1),
        "a retry of the lost reply"
    );
    st.answered(&alef, Some("This project's settings changed.".into()));
    assert!(!st.busy && st.error.is_some());
    // The next attempt is a new request, and an answer for another project's dialog is ignored.
    assert_eq!(st.press_save(|| rid(4)).unwrap().request, rid(4));
    let bet = ProjectRef::parse("bet").unwrap();
    st.answered(&bet, None);
    assert!(st.busy);
}
