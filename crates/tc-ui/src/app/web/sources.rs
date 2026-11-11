//! The actions of Project settings and Get source texts (unit B9a; tC4 `openSettings`,
//! `manageSettingsSources`, `openSources`, `pickGateway`, `setSourceBook`, `loadPackage`,
//! `downloadPackage`). Saving the settings is in `create.rs`; the checking-language change and the
//! release upgrades are C8's.

use leptos::prelude::*;
use tc_api::ApiError;
use tc_api::event::{Aspect, ChangeParts, ChangeScope};
use tc_api::home::HomeCard;
use tc_api::jobs::{Cancel, Phase};
use tc_api::refusal::Message;
use tc_api::resources::{Catalog, Download, GatewayPackage, PackageRow, Sources};
use tc_api::settings::ViewFromHome;
use tc_core::BookId;
use wasm_bindgen_futures::spawn_local;

use super::app_ctx::{Actions, Dialog, NetEnd};
use super::js;
use crate::app::client::CallError;
use crate::app::internet::Pending;
use crate::app::jobs::JobEnd;
use crate::app::sources::{Dl, DlEnd, SettingsForm, SourcesForm};

/// What a refusal says, in tC4's words; any other error as the server gave it.
pub(super) fn said(error: &ApiError) -> String {
    match error {
        ApiError::Refused(refusal) => match refusal.detail() {
            Some(detail) => detail.to_owned(),
            None => crate::i18n::refusal_text(refusal),
        },
        other => other.to_string(),
    }
}

/// What a failed call says: a refusal in tC4's words; a failure below the API in its own
/// words, never as a refusal the server did not make.
pub(super) fn said_call(error: &CallError) -> String {
    match error {
        CallError::Api(error) => said(error),
        other => other.to_string(),
    }
}

impl<T> NetEnd<T> {
    /// The answer, or what its failure says; `Err(None)` when the internet question or the
    /// sign-in step took over, or the reply was dropped with the project it was for.
    pub(super) fn said(self) -> Result<T, Option<String>> {
        match self {
            NetEnd::Ok(ok) => Ok(ok),
            NetEnd::Asked | NetEnd::Dropped => Err(None),
            NetEnd::Failed(error) => Err(Some(said(&error))),
            NetEnd::Transport(error) => Err(Some(error.to_string())),
        }
    }
}

impl Actions {
    /// A card's Settings (tC4 `openSettings`): the dialog at once with the card's facts, and
    /// one read of the project's files for the rest (AD14).
    pub fn open_settings(&self, card: &HomeCard) {
        let form = SettingsForm::of(card);
        let project = form.project.clone();
        self.s().layers.dialog.try_set(Some(Dialog::Settings(form)));
        let this = self.clone();
        spawn_local(async move {
            let request = ViewFromHome {
                project: project.clone(),
            };
            let read = this.runtime().api().call(&request).await;
            this.s().st_slot().try_update(|st| {
                let Some(st) = st else { return };
                match read {
                    Ok(view) => st.read(&project, view),
                    Err(error) => st.failed(&project, said_call(&error)),
                }
            });
        });
    }

    /// The direction chips and the font (tC4 `patchSt`): what Save sends is another request.
    pub fn patch_st(&self, patch: impl FnOnce(&mut SettingsForm)) {
        self.s().st_slot().try_update(|st| {
            if let Some(st) = st {
                patch(st);
                st.edited();
            }
        });
    }

    /// A package of the Checking language card (tC4 `chooseSettingsGateway`): Settings closes,
    /// the project opens, and the change of checking language is asked over it.
    pub fn choose_settings_gateway(&self, package: GatewayPackage) {
        let Some(project) = self
            .s()
            .st_slot()
            .with_untracked(|st| st.as_ref().map(|st| st.project.clone()))
        else {
            return;
        };
        self.close_modal();
        self.open_then_gateway(project, package);
    }

    /// "Manage source texts" (tC4 `manageSettingsSources`): Settings opens only from Home, and
    /// Get source texts needs the open project, so the project opens first and the dialog
    /// shows over it.
    pub fn manage_settings_sources(&self) {
        let Some(project) = self
            .s()
            .st_slot()
            .with_untracked(|st| st.as_ref().map(|st| st.project.clone()))
        else {
            return;
        };
        self.close_modal();
        self.open_then_sources(project);
    }

    /// Get source texts over the open project (tC4 `openSources`): step 1's packages are read
    /// again at each opening.
    pub fn open_sources(&self) {
        let s = self.s();
        s.layers.dialog.try_set(Some(Dialog::Sources));
        let Some(at) = s
            .project
            .with_untracked(|p| p.as_ref().map(|p| p.at.clone()))
        else {
            return;
        };
        // The sync toast whose Download asked for this closes now that it is open (#724).
        if s.sync_result
            .with_untracked(|t| t.as_ref().map(|t| t.project.clone()))
            .is_some_and(|p| p == at.project)
        {
            s.sync_result.try_set(None);
        }
        let this = self.clone();
        spawn_local(async move {
            this.read_packages(at).await;
        });
    }

    /// Reads step 1's packages for `at` (INV-RESOURCE-ANSWER-HAS-AN-OWNER): the one place they
    /// are read. An answer that comes after its open left the screen is dropped, so it never
    /// takes the place of the packages the open on screen has read.
    pub(super) async fn read_packages(&self, at: tc_api::Scope) {
        let read = Sources { at: at.clone() };
        if let Ok(view) = self.runtime().api().call(&read).await
            && self.shows(&at)
        {
            self.patch_src(|src| src.packages_read(at, view));
        }
    }

    pub fn patch_src(&self, patch: impl FnOnce(&mut SourcesForm)) {
        self.s().src.try_update(patch);
    }

    /// A package of step 1 (tC4 `pickGateway`).
    pub fn pick_gateway(&self, gateway: GatewayPackage) {
        self.patch_src(|src| src.pick(gateway));
        self.internet_task(Pending::Catalog);
    }

    /// "Change language" (tC4 `changeGateway`).
    pub fn change_gateway(&self) {
        self.patch_src(SourcesForm::change_gateway);
    }

    /// The Book select (tC4 `setSourceBook`).
    pub fn set_source_book(&self, book: BookId) {
        let chosen = self.s().src.try_update(|src| {
            src.set_book(book);
            src.gateway.is_some()
        });
        if chosen == Some(true) {
            self.internet_task(Pending::Catalog);
        }
    }

    pub fn toggle_source_row(&self, row: &PackageRow) {
        self.patch_src(|src| src.toggle(row));
    }

    /// "Read the list" after Not now (tC4 `allowSources`).
    pub fn allow_sources(&self) {
        let chosen = self.s().src.try_update(|src| {
            if src.gateway.is_some() {
                src.set_book(src.book);
            }
            src.gateway.is_some()
        });
        if chosen == Some(true) {
            self.internet_task(Pending::Catalog);
        }
    }

    /// The internet question was Not now: the catalog was not read.
    pub(super) fn catalog_dropped(&self) {
        self.patch_src(SourcesForm::not_read);
    }

    /// Reads the chosen package's rows for the chosen book.
    pub(super) fn catalog_now(&self) {
        let s = self.s();
        let Some(at) = s
            .project
            .with_untracked(|p| p.as_ref().map(|p| p.at.clone()))
        else {
            return;
        };
        let Some((gateway, book)) = s
            .src
            .with_untracked(|src| src.gateway.clone().map(|g| (g, src.book)))
        else {
            return;
        };
        self.patch_src(|src| {
            src.loading = true;
            src.needs_internet = false;
        });
        let this = self.clone();
        spawn_local(async move {
            let request = Catalog {
                at,
                gateway: gateway.gateway.clone(),
                book,
            };
            match this.run_net(Pending::Catalog, &request).await.said() {
                Ok(view) => this.patch_src(|src| src.rows_read(&gateway, book, view.rows)),
                Err(None) => {}
                Err(Some(reason)) => {
                    this.patch_src(|src| src.rows_failed(&gateway, book, reason));
                }
            }
        });
    }

    /// "Download package" (tC4 `downloadPackage`): the press is taken here, before the internet
    /// question and before the server answers, so a second press starts nothing.
    pub fn download_package(&self) {
        let Some(at) = self.project_scope() else {
            return;
        };
        let pressed = self
            .s()
            .src
            .try_update(|src| src.download_pressed(&at, js::random_request_id()))
            .flatten();
        if pressed.is_some() {
            self.internet_task(Pending::Download);
        }
    }

    /// The internet question was Not now: the download was not sent.
    pub(super) fn download_dropped(&self) {
        self.patch_src(SourcesForm::download_not_sent);
    }

    /// Sends the press that waits, and follows its job to the end.
    pub(super) fn download_now(&self) {
        let Some((request, what)) = self.s().src.with_untracked(SourcesForm::starting) else {
            return;
        };
        let this = self.clone();
        spawn_local(async move {
            let start = Download {
                request,
                at: what.at.clone(),
                gateway: what.gateway.gateway.clone(),
                book: what.book,
                repos: what.repos.clone(),
            };
            // A reason is said only in the open the press was made in.
            let said_here = |this: &Self, reason: String| this.shows(&what.at).then_some(reason);
            let job = match this.run_net(Pending::Download, &start).await {
                NetEnd::Ok(job) => job,
                // The question is up again: Turn on internet sends this press, Not now drops it.
                NetEnd::Asked => {
                    let next = js::random_request_id();
                    return this.patch_src(|src| src.download_asked_again(request, next));
                }
                NetEnd::Dropped => return this.download_dropped(),
                NetEnd::Failed(error) => {
                    let reason = said_here(&this, said(&error));
                    return this.patch_src(|src| src.download_refused(request, reason));
                }
                NetEnd::Transport(error) => {
                    let reason = said_here(&this, error.to_string());
                    return this.patch_src(|src| src.download_unanswered(request, reason));
                }
            };
            this.patch_src(|src| src.download_started(request, job));
            let ended = this
                .follow::<Download>(
                    job,
                    |progress| {
                        if let Phase::Install { repo } = &progress.phase {
                            this.patch_src(|src| src.download_progress(job, repo.clone()));
                        }
                    },
                    || true,
                )
                .await;
            // The state first: Cancel is not offered for a job that has ended.
            match ended {
                JobEnd::Done(done) => {
                    this.patch_src(|src| src.download_ended(job, DlEnd::Done(done)));
                }
                JobEnd::Cancelled | JobEnd::Lost | JobEnd::Left => {
                    this.patch_src(|src| src.download_ended(job, DlEnd::Stopped));
                }
                JobEnd::Failed(error) => {
                    // The selection waits before the refusal is sorted, so each way the
                    // sorting can go finds it: the question sends it again, a dropped
                    // question drops it, any other failure refuses it.
                    let retry = js::random_request_id();
                    this.patch_src(|src| src.download_failed(job, retry));
                    if let Some(error) = this.net_refusal(Pending::Download, error) {
                        let reason = said_here(&this, said(&error));
                        this.patch_src(|src| src.download_refused(retry, reason));
                    }
                }
            }
            // Whatever the end, a repository may have installed before it: what a pane or a
            // help lacked may be here now, so Understand reads again (tC4 bumps
            // `installEpoch`), and step 1 counts the package. Installs are the computer's, so
            // the open on screen now reads again, which may not be the one that pressed.
            if let Some(now) = this.project_scope() {
                let installed = ChangeScope::Parts(ChangeParts {
                    aspects: vec![Aspect::Pins],
                    ..ChangeParts::default()
                });
                this.runtime().cache().changed(&now, &installed);
                this.read_packages(now).await;
            }
        });
    }

    /// Cancel while a download runs: a declared difference, since tC4 has none (B9a). What was
    /// not finished is not installed.
    pub fn cancel_download(&self) {
        let Some(job) = self.s().src.with_untracked(|src| match src.dl() {
            Dl::Running { job, .. } => Some(*job),
            Dl::Idle | Dl::Starting { .. } | Dl::Finished { .. } | Dl::Unanswered { .. } => None,
        }) else {
            return;
        };
        let this = self.clone();
        spawn_local(async move {
            let cancel = Cancel {
                request: js::random_request_id(),
                job,
            };
            let _ = this.runtime().api().call(&cancel).await;
        });
    }
}
