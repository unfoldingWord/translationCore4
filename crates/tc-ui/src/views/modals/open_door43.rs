//! Open a project from Door43 (M6, unit B9b; `tC4:src/views/modals/OpenFromDoor43.jsx`, #677):
//! the fourth card of "Add a project" opens it. The repository is `owner/repository` or a link;
//! it asks for no name (ruling H14, a declared difference: tC4 asks for one), so the project
//! keeps the name the team gave it. A refusal shows in a warn callout with its code, and no
//! project was added. The note names the server without tC4's "Only public repositories can be
//! opened": a private repository opens after sign-in here (Q3).

use std::sync::Arc;

use leptos::prelude::*;

use crate::app::open_door43::{
    Downloading, OpenForm, OpenRefusal, OpenStep, RefusalSentence, RepoError, refusal_sentence,
};
use crate::app::web::{AppCtx, use_app};
use crate::ds::{
    Attrs, Button, ButtonVariant, Callout, CalloutTone, Field, Input, Size, Text, TextRole,
    TextTone,
};
use crate::i18n::{keys, t};

/// The dialog, while `s.modal` is Open from Door43 and its form is set.
#[component]
pub fn OpenFromDoor43() -> impl IntoView {
    let Some(AppCtx { s, actions }) = use_app() else {
        return ().into_any();
    };
    let od = s.open_door43_form();
    let account = s.server.account.clone();
    let host = Memo::new(move |_| account.with(|a| a.server.clone()));
    let busy = { Signal::derive(move || od.with(|od| od.as_ref().is_some_and(OpenForm::busy))) };
    // Cancel closes the dialog while nothing runs, and stops the open while it downloads a
    // pinned version (#1013); it is off while the project is fetched and while the open stops.
    let cancel_off = {
        Signal::derive(move || {
            od.with(|od| od.as_ref().is_some_and(|od| od.busy() && !od.can_cancel()))
        })
    };
    let cant_open = {
        Signal::derive(move || {
            let host = host.get();
            od.with(|od| od.as_ref().and_then(|od| od.ready(&host)).is_none())
        })
    };

    let footer: ChildrenFn = {
        let actions = actions.clone();
        Arc::new(move || {
            let (cancel, open) = (actions.clone(), actions.clone());
            view! {
                <Button
                    variant=ButtonVariant::Secondary
                    disabled=cancel_off
                    attrs=Attrs::from([("data-testid", "open-door43-cancel")])
                    on_click=Callback::new(move |_| {
                        if busy.get_untracked() {
                            cancel.cancel_open_door43();
                        } else {
                            cancel.close_modal();
                        }
                    })
                >
                    {move || t(keys::open_door43::CANCEL, &[])}
                </Button>
                <Button
                    disabled=cant_open
                    aria_busy=busy
                    attrs=Attrs::from([("data-testid", "open-door43-submit")])
                    on_click=Callback::new(move |_| open.open_door43_run())
                >
                    {move || t(if busy.get() { keys::open_door43::OPENING } else { keys::open_door43::OPEN }, &[])}
                </Button>
            }
            .into_any()
        })
    };

    let children: ChildrenFn = {
        let (actions, od) = (actions.clone(), od);
        Arc::new(move || {
            let (actions, od) = (actions.clone(), od);
            let text = |get: fn(&OpenForm) -> String| -> Signal<String> {
                Signal::from(Memo::new(move |_| {
                    od.with(|od| od.as_ref().map(get).unwrap_or_default())
                }))
            };
            let repo = text(|od| od.repo.clone());
            let repo_error: Signal<Option<String>> = {
                Signal::from(Memo::new(move |_| {
                    let host = host.get();
                    od.with(|od| od.as_ref().and_then(|od| od.repo_error(&host)))
                        .map(|RepoError::Bad| t(keys::open_door43::REPO_BAD, &[("host", &host)]))
                }))
            };
            let on_repo = {
                let actions = actions.clone();
                Callback::new(move |e: web_sys::Event| {
                    let value = event_target_value(&e);
                    actions.edit_od(|od| od.type_repo(value));
                })
            };
            let refusal = {
                Memo::new(move |_| od.with(|od| od.as_ref().and_then(OpenForm::refusal).cloned()))
            };
            let yours =
                Memo::new(move |_| od.with(|od| od.as_ref().and_then(|od| od.yours.clone())));
            let step = Memo::new(move |_| {
                od.with(|od| od.as_ref().map(|od| od.step.clone()).unwrap_or_default())
            });
            let below = {
                let actions = actions.clone();
                move || {
                    if let Some(project) = yours.get() {
                        return already_here(&actions, project).into_any();
                    }
                    match step.get() {
                        OpenStep::Downloading(download) | OpenStep::Stopping(download) => {
                            return downloading(&download).into_any();
                        }
                        OpenStep::Cancelled => return cancelled().into_any(),
                        OpenStep::Getting => {}
                    }
                    match refusal.get() {
                    Some(refusal) => refused(&actions, refusal).into_any(),
                    None => view! {
                        <Text role=TextRole::Caption tone=TextTone::Muted>
                            {move || t(keys::open_door43::CHECKS, &[("sync", &t(keys::home::SYNC, &[]))])}
                        </Text>
                    }
                    .into_any(),
                }
                }
            };
            view! {
                <div style="display: flex; flex-direction: column; gap: 16px; padding-bottom: 6px;">
                    <Callout tone=CalloutTone::Info>
                        {move || t(keys::open_door43::WHERE_ANY, &[("host", &host.get())])}
                    </Callout>
                    <Field
                        label=Signal::derive(|| t(keys::open_door43::REPO, &[]))
                        hint=Signal::derive(|| t(keys::open_door43::REPO_HINT, &[]))
                        live_error=repo_error
                    >
                        <Input
                            value=repo
                            invalid=Signal::derive(move || repo_error.with(Option::is_some))
                            disabled=busy
                            attrs=Attrs::from([("data-testid", "open-door43-repo")])
                            on_change=on_repo
                        />
                    </Field>
                    {below}
                </div>
            }
            .into_any()
        })
    };

    let close = actions.clone();
    crate::ds::Modal(crate::ds::ModalProps {
        title: Some((move || move || t(keys::open_door43::TITLE, &[])).into()),
        subtitle: Some((move || move || t(keys::open_door43::SUBTITLE, &[])).into()),
        width: Some(520.into()),
        close_label: Some(Signal::derive(|| t(keys::common::CLOSE, &[]))),
        on_close: Some(Callback::new(move |()| close.close_modal())),
        // Cancel and the close are off while the open runs, so a refusal always has its dialog.
        closable: Signal::derive(move || !busy.get()),
        footer: Some(footer),
        attrs: Attrs::from([("data-testid", "open-door43-modal")]),
        children: Some(children),
        ..Default::default()
    })
    .into_any()
}

/// The version the open downloads now, and how many follow it (#1013): said as a status, so a
/// screen reader hears each one.
fn downloading(download: &Downloading) -> impl IntoView + use<> {
    let (pin, left) = (download.pin.clone(), download.left.to_string());
    view! {
        <Callout tone=CalloutTone::Info attrs=Attrs::from([("data-testid", "open-door43-progress"), ("role", "status")])>
            {move || t(keys::open_door43::DOWNLOADING, &[("pin", &pin), ("n", &left)])}
        </Callout>
    }
}

/// The last open was cancelled (#1013): no project was added.
fn cancelled() -> impl IntoView + use<> {
    view! {
        <Callout tone=CalloutTone::Info attrs=Attrs::from([("data-testid", "open-door43-cancelled"), ("role", "status")])>
            {move || t(keys::open_door43::CANCELLED, &[])}
        </Callout>
    }
}

/// The repository's project is on this computer (ruling H14): no second copy, and Open it.
fn already_here(
    actions: &crate::app::web::Actions,
    project: tc_api::ids::ProjectRef,
) -> impl IntoView + use<> {
    let open = actions.clone();
    view! {
        <Callout tone=CalloutTone::Info attrs=Attrs::from([("data-testid", "open-door43-yours"), ("role", "status")])>
            <div style="display: flex; flex-direction: column; gap: 6px;">
                <span>{move || t(keys::open_door43::ALREADY_HERE, &[])}</span>
                <div>
                    <Button
                        size=Size::Sm
                        attrs=Attrs::from([("data-testid", "open-door43-open-yours")])
                        on_click=Callback::new(move |_| open.open_door43_yours(project.clone()))
                    >
                        {move || t(keys::open_door43::OPEN_YOURS, &[])}
                    </Button>
                </div>
            </div>
        </Callout>
    }
}

/// tC4's artboard g: the refusal, its code, "No project was added", and Ask for help.
fn refused(actions: &crate::app::web::Actions, refusal: OpenRefusal) -> impl IntoView + use<> {
    let sentence = refusal_sentence(&refusal);
    let said = {
        let sentence = sentence.clone();
        move || match &sentence {
            RefusalSentence::Of(key) => t(*key, &[]),
            RefusalSentence::Own(text) => text.clone(),
        }
    };
    let code = refusal.code.clone().unwrap_or_default();
    let help = actions.clone();
    let on_help = {
        let refusal = refusal.clone();
        Callback::new(move |_| {
            let text = match &sentence {
                RefusalSentence::Of(key) => {
                    let text = t(*key, &[]);
                    format!("{text}\n\n{}", refusal.reason).trim().to_owned()
                }
                RefusalSentence::Own(text) => {
                    format!("{text}\n\n{}", refusal.reason).trim().to_owned()
                }
            };
            help.ask_for_help(crate::app::feedback::HelpRequest {
                code: refusal.code.clone().unwrap_or_default(),
                text,
                report: None,
            });
        })
    };
    let shown_code = refusal.code.clone();
    view! {
        <Callout
            tone=CalloutTone::Warn
            attrs=Attrs::from([("data-testid", "open-door43-refused"), ("data-code", code.as_str()), ("role", "alert")])
        >
            <div style="display: flex; flex-direction: column; gap: 6px;">
                <Text role=TextRole::Strong>{move || t(keys::open_door43::REFUSED_TITLE, &[])}</Text>
                <span data-testid="open-door43-refusal">{said}</span>
                <span>
                    {shown_code.map(|code| view! { <code>{code}</code> " · " })}
                    {move || t(keys::open_door43::NOTHING_WRITTEN, &[])}
                </span>
                <div>
                    <Button
                        size=Size::Sm
                        variant=ButtonVariant::Outline
                        attrs=Attrs::from([("data-testid", "open-door43-help")])
                        on_click=on_help
                    >
                        {move || t(keys::feedback::ASK, &[])}
                    </Button>
                </div>
            </div>
        </Callout>
    }
}
