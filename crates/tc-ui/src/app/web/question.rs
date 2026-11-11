//! A question a move away waits on: Stay, or go without what was not saved. One question is
//! open at a time; an older one still open gives way, and its wait ends as Stay.

use std::cell::RefCell;

use js_sys::{Function, Promise};
use wasm_bindgen::JsValue;
use wasm_bindgen_futures::JsFuture;

pub(super) struct Question(RefCell<Option<Function>>);

impl Question {
    pub(super) const fn new() -> Self {
        Self(RefCell::new(None))
    }

    /// Opens the question. The caller shows it, then awaits [`answered`] outside the borrow of
    /// the thread-local that holds this.
    pub(super) fn open(&self) -> Promise {
        Promise::new(&mut |resolve, _| {
            if let Some(older) = self.0.borrow_mut().replace(resolve) {
                let _ = older.call1(&JsValue::NULL, &JsValue::FALSE);
            }
        })
    }

    /// Whether a question waits for its answer. An older question that gave way reads this
    /// before it takes the dialog down, so the newer one stays shown.
    pub(super) fn is_open(&self) -> bool {
        self.0.borrow().is_some()
    }

    /// The person's answer; nothing when no question is open.
    pub(super) fn answer(&self, go: bool) {
        if let Some(resolve) = self.0.borrow_mut().take() {
            let _ = resolve.call1(&JsValue::NULL, &JsValue::from_bool(go));
        }
    }
}

/// The answer of an opened question: whether to go.
pub(super) async fn answered(question: Promise) -> bool {
    JsFuture::from(question)
        .await
        .ok()
        .and_then(|v| v.as_bool())
        .unwrap_or(false)
}
