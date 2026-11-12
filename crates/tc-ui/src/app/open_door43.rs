//! "Open a project from Door43" (M6, unit B9b; tC4's `od`, #677,
//! `tC4:src/views/modals/OpenFromDoor43.jsx`): the repository and the refusal with its code.
//! It asks for no name, unlike tC4 (ruling H14, a declared difference): the project keeps its
//! Door43 name. Pure; the rules of a repository are `tc_api::door43`'s, which the server
//! applies too.

use tc_api::door43::RepoSource;
use tc_api::ids::{ProjectRef, RequestId};

use crate::app::submit::Submit;
use crate::i18n::{Key, keys};

/// A refusal of the open: its code and the sentence the code has.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OpenRefusal {
    pub code: Option<String>,
    /// What "Ask for help" adds after the sentence: the refusal as the server gave it.
    pub reason: String,
    /// The refusal's own sentence, when it names what failed (a pinned version that was not
    /// downloaded, #1013): no fixed sentence of a code can.
    pub own: Option<String>,
}

/// tC4's `od`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OpenForm {
    pub repo: String,
    /// Open project's attempt: one request per attempt (UI-3).
    pub submit: Submit,
    pub error: Option<OpenRefusal>,
    /// The repository's project is on this computer as this folder (ruling H14): no second
    /// copy is made, and the dialog offers to open this one.
    pub yours: Option<ProjectRef>,
}

/// The error under the repository field.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RepoError {
    /// `openDoor43.repoBad`.
    Bad,
}

impl OpenForm {
    /// The dialog as it opens, with the request of its first attempt.
    pub fn new(request: RequestId) -> Self {
        Self {
            repo: String::new(),
            submit: Submit::new(request),
            error: None,
            yours: None,
        }
    }

    /// An open runs: the dialog's controls are off.
    pub fn busy(&self) -> bool {
        self.submit.busy()
    }

    /// The repository typed (tC4's `onRepo`): the last refusal goes.
    pub fn type_repo(&mut self, repo: String) {
        self.repo = repo;
        self.error = None;
        self.yours = None;
    }

    /// The server found the repository's project here: the form names it, and the next press
    /// is a new attempt with `next`.
    pub fn already_here(&mut self, project: ProjectRef, next: RequestId) {
        self.submit.refused(String::new(), next);
        self.error = None;
        self.yours = Some(project);
    }

    pub fn source(&self, host: &str) -> Option<RepoSource> {
        RepoSource::from_input(&self.repo, host)
    }

    pub fn repo_error(&self, host: &str) -> Option<RepoError> {
        (!self.repo.trim().is_empty() && self.source(host).is_none()).then_some(RepoError::Bad)
    }

    /// The refusal the callout shows.
    pub fn refusal(&self) -> Option<&OpenRefusal> {
        self.error.as_ref()
    }

    /// What Open project sends, or `None` while it is off: the repository does not parse, or
    /// an open runs.
    pub fn ready(&self, host: &str) -> Option<RepoSource> {
        if self.busy() {
            return None;
        }
        self.source(host)
    }

    /// No usable answer from the app's server: the reason shows, and the next press sends the
    /// same request again.
    pub fn lost(&mut self, reason: String) {
        self.submit.lost(reason.clone());
        self.error = Some(OpenRefusal {
            code: None,
            reason,
            own: None,
        });
    }

    /// The run ended in a refusal: the form takes it and can be changed again, and the next
    /// press is a new attempt with `next`.
    pub fn refused(&mut self, code: Option<&str>, reason: String, next: RequestId) {
        self.submit.refused(reason.clone(), next);
        self.error = Some(OpenRefusal {
            code: code.map(str::to_owned),
            reason,
            own: None,
        });
    }

    /// The run ended in a refusal that says what failed in its own `sentence`; `detail` is
    /// what "Ask for help" adds after it.
    pub fn refused_in_its_words(
        &mut self,
        code: Option<&str>,
        sentence: String,
        detail: String,
        next: RequestId,
    ) {
        self.submit.refused(sentence.clone(), next);
        self.error = Some(OpenRefusal {
            code: code.map(str::to_owned),
            reason: detail,
            own: Some(sentence),
        });
    }
}

/// What the callout says for a refusal.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RefusalSentence {
    /// The sentence the refusal's code has.
    Of(Key),
    /// The refusal's own sentence, which names what failed: no fixed sentence can.
    Own(String),
}

/// The sentence for `refusal`: its own when it has one, which names the version that was
/// not downloaded (#1013); else the sentence of its code.
pub fn refusal_sentence(refusal: &OpenRefusal) -> RefusalSentence {
    match &refusal.own {
        Some(sentence) => RefusalSentence::Own(sentence.clone()),
        None => RefusalSentence::Of(refusal_key(refusal.code.as_deref())),
    }
}

/// The sentence of a refusal code (tC4's `REFUSAL_TEXT`): one per code the open meets, and the
/// general one for any other or none. The general one is Q-21's, without tC4's "make sure that
/// the repository is public": the rebuild opens private repositories after sign-in (Q3). tC4's
/// `sync.obs-unsupported` has none: story projects open and sync like Bibles here (Q2).
pub fn refusal_key(code: Option<&str>) -> Key {
    match code {
        Some("sync.incoming-invalid") => keys::open_door43::refused::INVALID,
        Some("open-door43.no-journal") => keys::open_door43::refused::NO_JOURNAL,
        Some("sync.clone-path-exists") => keys::open_door43::refused::CLONE_PATH_EXISTS,
        Some("opslog.not-loaded") => keys::open_door43::refused::OPS_NOT_LOADED,
        Some("sync.offline") => keys::open_door43::refused::OFFLINE,
        Some("sync.move-failed") => keys::open_door43::refused::MOVE_FAILED,
        _ => keys::open_door43::refused::NOT_OPENED,
    }
}
