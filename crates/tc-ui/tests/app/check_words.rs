//! INV-CHECK-WORDS-ONE-STATE (#853): the words of the shown check under every order of events.
//!
//! The page's words are one state, `CheckWords`. This plays generated orders of what a
//! translator, the server and a teammate can do against a small model of the server, and holds
//! these rules after every step:
//!
//! - what the person selected shows at once, and no reply or read changes it while it holds
//!   the check;
//! - a mark, a restore and Leave without them free the check at the press; a mark that is
//!   saved keeps it free; a mark or restore that is not saved gives the person's words back;
//! - a screen that holds no change of the person shows the words the check will have stored
//!   once the page's own writes are done, as far as the page has seen the stored words.
//!
//! The model is of the words only. What a mark does to the status is the server's rule, tested
//! in `tc-check` and `tc-app`.
//!
//! While a mark or a restore is being saved the screen has the words and the marks off. The
//! generator sends those acts anyway: the machine must refuse each one and change nothing.
//!
//! The server model assumes only what the page guarantees. Its decision writes go one at a
//! time. A restore waits for the save gate before it takes its turn, so later writes and reads
//! can go before it, and the gate can refuse it. A read goes out only when no write holds a
//! turn, and is answered before or after a write pressed later. A saved write makes the page
//! read again, which drops any read still on its way. A reply can be lost after the server
//! stored the write. The person can leave the check with writes on their way and come back.

use std::collections::{BTreeSet, VecDeque};

use proptest::prelude::*;
use tc_api::check::DecideEdit;
use tc_ui::app::check_item::{CheckWords, Stepped, WordsEvent, WriteId, valid_edit};

type Words = BTreeSet<u32>;

/// What a write does on the server.
#[derive(Debug, Clone)]
enum Wire {
    Sets(Words),
    Leaves,
    Restores(Words),
}

#[derive(Debug, Clone)]
enum Act {
    /// The person finishes a change of the selected words; the screen sends its unmark.
    Tap(Words),
    /// The pointer is down and passes over words: nothing is sent until it goes up.
    Drag(Words),
    /// The pointer goes down and passes over the words already on screen.
    DragOver,
    Release,
    Valid,
    Invalid,
    Todo,
    Restore(Words),
    /// A waiting restore passes the save gate and takes its turn, or the gate refuses it.
    Gate {
        passes: bool,
    },
    /// The server stores the oldest write; its reply is still on its way.
    Store,
    /// The oldest write is answered. `lost`: the server stored it and the reply never came.
    Answer {
        saved: bool,
        lost: bool,
    },
    /// A read goes out. `late`: the server answers it at the moment it lands.
    Read {
        late: bool,
    },
    Land,
    /// A teammate's sync changes the stored words.
    Teammate(Words),
    /// The verse text changes, and with it the words the check has stored.
    TextChange(Words),
    LeaveWithoutThem,
    /// The person goes to another check, and comes back to this one.
    Leave,
    Return,
}

fn words() -> impl Strategy<Value = Words> {
    proptest::collection::btree_set(0u32..4, 0..4)
}

fn act() -> impl Strategy<Value = Act> {
    prop_oneof![
        5 => words().prop_map(Act::Tap),
        1 => words().prop_map(Act::Drag),
        2 => Just(Act::DragOver),
        1 => Just(Act::Release),
        3 => Just(Act::Valid),
        2 => Just(Act::Invalid),
        2 => Just(Act::Todo),
        2 => words().prop_map(Act::Restore),
        2 => any::<bool>().prop_map(|passes| Act::Gate { passes }),
        3 => Just(Act::Store),
        6 => (any::<bool>(), proptest::bool::weighted(0.1))
            .prop_map(|(saved, lost)| Act::Answer { saved, lost }),
        3 => any::<bool>().prop_map(|late| Act::Read { late }),
        4 => Just(Act::Land),
        1 => words().prop_map(Act::Teammate),
        1 => words().prop_map(Act::TextChange),
        1 => Just(Act::LeaveWithoutThem),
        1 => Just(Act::Leave),
        2 => Just(Act::Return),
    ]
}

struct Sent {
    id: WriteId,
    wire: Wire,
    stored: bool,
}

/// The marks and restores pressed over words the person held that have no reply yet, and
/// those words.
struct Answers {
    ids: Vec<WriteId>,
    words: Words,
}

struct World {
    server: Words,
    page: CheckWords,
    /// The writes that hold or wait for a turn, oldest first.
    wire: VecDeque<Sent>,
    /// The restores still waiting at the save gate.
    gate: VecDeque<Sent>,
    /// The read on its way: its answer, or `None` until it lands when it is a late one.
    read: Option<Option<Words>>,
    /// A saved write wants the check read again, once no write is on its way.
    refresh: bool,
    /// The page has seen the stored words as they are: the last read that landed showed them,
    /// and since then only the page's own writes changed them.
    seen: bool,
    answers: Option<Answers>,
    /// The words on the line when the pointer went down.
    dragging: Option<Words>,
    away: bool,
}

impl World {
    fn new(stored: Words) -> Self {
        let mut page = CheckWords::default();
        page.step(WordsEvent::Shown(stored.clone()));
        Self {
            server: stored,
            page,
            wire: VecDeque::new(),
            gate: VecDeque::new(),
            read: None,
            refresh: false,
            seen: true,
            answers: None,
            dragging: None,
            away: false,
        }
    }

    fn sent(id: WriteId, wire: Wire) -> Sent {
        Sent {
            id,
            wire,
            stored: false,
        }
    }

    /// Steps the page with an act of the person. The page obeys the machine: a refused act
    /// changes nothing and sends nothing. Answers the write to send, if one leaves.
    fn act(&mut self, event: WordsEvent<'_>) -> Result<Option<WriteId>, TestCaseError> {
        let before = self.page.clone();
        match self.page.step(event) {
            Stepped::Send(id) => Ok(Some(id)),
            Stepped::Done => Ok(None),
            Stepped::Refused => {
                prop_assert!(
                    before.saving(),
                    "an act was refused with nothing being saved"
                );
                prop_assert_eq!(&self.page, &before, "a refused act changed the words");
                Ok(None)
            }
        }
    }

    fn store_front(&mut self) {
        if let Some(front) = self.wire.front_mut()
            && !front.stored
        {
            front.stored = true;
            match &front.wire {
                Wire::Sets(words) => self.server = words.clone(),
                // Only a read can tell the page which words a restore brought back.
                Wire::Restores(words) => {
                    self.server = words.clone();
                    self.seen = false;
                }
                Wire::Leaves => {}
            }
        }
    }

    fn land(&mut self) {
        if let Some(read) = self.read.take() {
            let stored = read.unwrap_or_else(|| self.server.clone());
            // A write the server stored whose reply is still on its way is in this read
            // already; what the page then makes of the reply is settled by the read after it.
            self.seen = stored == self.server && !self.wire.iter().any(|sent| sent.stored);
            self.page.step(WordsEvent::Read {
                stored,
                same_text: true,
            });
        }
    }

    /// The pointer goes up: a gesture that changed the words sends one unmark.
    fn release(&mut self) -> Result<(), TestCaseError> {
        if let Some(before) = self.dragging.take()
            && before != self.page.shown()
            && let Some(id) = self.act(WordsEvent::Sent(&DecideEdit::Unmark))?
        {
            self.answers = None;
            self.wire
                .push_back(Self::sent(id, Wire::Sets(Words::new())));
        }
        Ok(())
    }

    /// A mark or a restore was pressed: it answers for the words the person held.
    fn answers_for(&mut self, id: WriteId, held: bool, shown: &Words) {
        // The page forgets a press of the pointer once a mark or a restore leaves.
        self.dragging = None;
        match &mut self.answers {
            Some(answers) => answers.ids.push(id),
            None if held => {
                self.answers = Some(Answers {
                    ids: vec![id],
                    words: shown.clone(),
                });
            }
            None => {}
        }
    }

    /// The page hears the answer of write `id`.
    fn reply(&mut self, id: WriteId, saved: bool) -> Result<(), TestCaseError> {
        let (shown, held) = (self.page.shown(), self.page.unsaved());
        self.page.step(WordsEvent::Replied { id, saved });
        if self.away {
            return Ok(());
        }
        if held {
            prop_assert_eq!(&self.page.shown(), &shown, "a reply changed held words");
        }
        if let Some(answers) = &mut self.answers
            && answers.ids.contains(&id)
        {
            answers.ids.retain(|answer| *answer != id);
            let (left, words) = (answers.ids.len(), answers.words.clone());
            if saved {
                // The first mark saved ends the person's change, whatever a later one does.
                self.answers = None;
                prop_assert!(!self.page.unsaved(), "a saved mark left the check held");
            } else if left > 0 {
                prop_assert!(!self.page.unsaved(), "a mark still on its way answers");
            } else {
                self.answers = None;
                if words == self.page.stored() {
                    prop_assert!(!self.page.unsaved());
                } else {
                    prop_assert_eq!(
                        self.page.shown(),
                        words,
                        "marks that were not saved did not give the words back"
                    );
                    prop_assert!(self.page.unsaved());
                }
            }
        }
        Ok(())
    }

    fn play(&mut self, act: &Act) -> Result<(), TestCaseError> {
        let person = matches!(
            act,
            Act::Tap(_)
                | Act::Drag(_)
                | Act::DragOver
                | Act::Release
                | Act::Valid
                | Act::Invalid
                | Act::Todo
                | Act::Restore(_)
                | Act::TextChange(_)
                | Act::LeaveWithoutThem
                | Act::Read { .. }
                | Act::Land
        );
        if self.away && person {
            return Ok(());
        }
        if matches!(
            act,
            Act::Tap(_) | Act::TextChange(_) | Act::LeaveWithoutThem
        ) {
            self.release()?;
        }
        let (shown, held) = (self.page.shown(), self.page.unsaved());
        match act {
            Act::Tap(to) => {
                if *to == shown {
                    return Ok(());
                }
                if self.page.saving() {
                    self.act(WordsEvent::Selected(to.clone()))?;
                    self.act(WordsEvent::Sent(&DecideEdit::Unmark))?;
                    return Ok(());
                }
                self.answers = None;
                self.act(WordsEvent::Selected(to.clone()))?;
                if let Some(id) = self.act(WordsEvent::Sent(&DecideEdit::Unmark))? {
                    self.wire
                        .push_back(Self::sent(id, Wire::Sets(Words::new())));
                }
                prop_assert_eq!(&self.page.shown(), to, "a tap shows at once");
                prop_assert_eq!(self.page.unsaved(), !to.is_empty());
            }
            Act::Drag(to) => {
                if self.page.saving() {
                    self.act(WordsEvent::Selected(to.clone()))?;
                    return Ok(());
                }
                self.dragging.get_or_insert(shown.clone());
                if *to != shown {
                    self.answers = None;
                }
                self.act(WordsEvent::Selected(to.clone()))?;
                prop_assert_eq!(&self.page.shown(), to, "a drag shows at once");
            }
            Act::DragOver => {
                if !self.page.saving() {
                    self.dragging.get_or_insert(shown.clone());
                }
                self.act(WordsEvent::Selected(shown.clone()))?;
                prop_assert_eq!(&self.page.shown(), &shown);
                prop_assert_eq!(
                    self.page.unsaved(),
                    held,
                    "a drag over the same words changed the hold"
                );
            }
            Act::Release => self.release()?,
            Act::Valid => {
                if let Some(id) = self.act(WordsEvent::Sent(&valid_edit(&shown)))? {
                    self.answers_for(id, held, &shown);
                    self.wire
                        .push_back(Self::sent(id, Wire::Sets(shown.clone())));
                    prop_assert_eq!(
                        &self.page.shown(),
                        &shown,
                        "Mark valid keeps the words on screen"
                    );
                    prop_assert!(self.page.saving() && !self.page.unsaved());
                }
            }
            Act::Invalid => {
                if let Some(id) = self.act(WordsEvent::Sent(&DecideEdit::Invalid))? {
                    self.answers_for(id, held, &shown);
                    self.wire
                        .push_back(Self::sent(id, Wire::Sets(Words::new())));
                    prop_assert!(self.page.shown().is_empty(), "Mark invalid shows no words");
                    prop_assert!(self.page.saving() && !self.page.unsaved());
                }
            }
            Act::Todo => {
                if let Some(id) = self.act(WordsEvent::Sent(&DecideEdit::Todo))? {
                    self.answers_for(id, held, &shown);
                    self.wire.push_back(Self::sent(id, Wire::Leaves));
                    prop_assert!(self.page.saving() && !self.page.unsaved());
                }
            }
            Act::Restore(to) => {
                if let Some(id) = self.act(WordsEvent::Restore)? {
                    self.answers_for(id, held, &shown);
                    self.gate
                        .push_back(Self::sent(id, Wire::Restores(to.clone())));
                    prop_assert!(self.page.saving() && !self.page.unsaved());
                }
            }
            Act::Gate { passes } => {
                if let Some(restore) = self.gate.pop_front() {
                    if *passes {
                        self.wire.push_back(restore);
                    } else {
                        self.reply(restore.id, false)?;
                    }
                }
            }
            Act::Store => self.store_front(),
            Act::Answer { saved, lost } => {
                if *saved {
                    self.store_front();
                }
                if let Some(front) = self.wire.pop_front() {
                    // The page hears "saved" only for a write the server stored, and hears
                    // nothing good of one whose reply was lost.
                    let heard = front.stored && !lost;
                    if front.stored && !heard {
                        self.seen = false;
                    }
                    self.reply(front.id, heard)?;
                    // As the page does: a saved write reads the check again, which drops any
                    // read still on its way, and the new read waits for the writes behind it.
                    if heard && !self.away {
                        self.read = None;
                        self.refresh = true;
                    }
                    if self.refresh && self.wire.is_empty() && !self.away {
                        self.refresh = false;
                        self.read = Some(None);
                    }
                }
            }
            Act::Read { late } => {
                // The page sends a read only when none of its writes holds a turn. A restore
                // still at the gate holds none.
                if self.wire.is_empty() {
                    self.read = Some((!late).then(|| self.server.clone()));
                }
            }
            Act::Land => {
                self.land();
                if held {
                    prop_assert_eq!(&self.page.shown(), &shown, "a read changed held words");
                    // The hold ends only when the read shows these very words stored (a
                    // teammate marked the check with them).
                    prop_assert!(self.page.unsaved() || self.page.stored() == shown);
                }
            }
            Act::Teammate(to) => {
                self.server = to.clone();
                self.seen = false;
            }
            Act::TextChange(to) => {
                if self.wire.is_empty() {
                    self.server = to.clone();
                    self.read = None;
                    self.answers = None;
                    self.seen = self.gate.is_empty();
                    self.page.step(WordsEvent::Read {
                        stored: to.clone(),
                        same_text: false,
                    });
                    prop_assert!(!self.page.unsaved(), "words of the old text hold the check");
                    prop_assert_eq!(&self.page.shown(), to);
                }
            }
            // Leave without them waits for a save, so it never reaches the words under one.
            Act::LeaveWithoutThem => {
                if !self.page.saving() {
                    self.answers = None;
                    self.act(WordsEvent::Dropped)?;
                    prop_assert!(!self.page.unsaved());
                }
            }
            Act::Leave => {
                if !self.away {
                    self.release()?;
                    self.away = true;
                    self.answers = None;
                    self.read = None;
                    self.refresh = false;
                    self.page.step(WordsEvent::Shown(Words::new()));
                }
            }
            Act::Return => {
                // The read of the check come back to waits for the writes that hold a turn.
                if self.away && self.wire.is_empty() {
                    self.away = false;
                    self.seen = self.gate.is_empty();
                    self.page.step(WordsEvent::Shown(self.server.clone()));
                    prop_assert!(!self.page.unsaved());
                }
            }
        }
        if self.away {
            return Ok(());
        }
        // At any moment, not only at the end: a screen that holds no change of the person
        // shows the words the check will have stored once the page's own writes are done.
        if self.seen && self.page.shown() == self.page.stored() {
            let mut will_store = Some(self.server.clone());
            for sent in self.wire.iter().filter(|sent| !sent.stored) {
                match &sent.wire {
                    Wire::Sets(words) => will_store = Some(words.clone()),
                    Wire::Leaves => {}
                    // Only a read can tell the page which words a restore brings back.
                    Wire::Restores(_) => will_store = None,
                }
            }
            if let Some(will_store) = will_store {
                prop_assert_eq!(
                    self.page.shown(),
                    will_store,
                    "the screen shows words the check will not have stored"
                );
            }
        }
        prop_assert!(
            !(self.page.saving() && self.page.unsaved()),
            "a mark being saved answers for the words"
        );
        if self.page.unsaved() {
            prop_assert!(!self.page.shown().is_empty(), "no words hold no check");
            prop_assert_ne!(
                self.page.shown(),
                self.page.stored(),
                "stored words hold no check"
            );
        }
        Ok(())
    }

    /// The pointer goes up, every write is answered as saved, the person is on the check, and
    /// a fresh read lands.
    fn settle(&mut self) -> Result<(), TestCaseError> {
        if !self.away {
            self.release()?;
        }
        while let Some(restore) = self.gate.pop_front() {
            self.wire.push_back(restore);
        }
        while !self.wire.is_empty() {
            self.store_front();
            if let Some(front) = self.wire.pop_front() {
                self.reply(front.id, true)?;
            }
        }
        if self.away {
            self.away = false;
            self.page.step(WordsEvent::Shown(self.server.clone()));
        }
        self.read = Some(None);
        self.land();
        prop_assert!(
            !self.page.saving(),
            "nothing is on its way, and the screen is still off"
        );
        Ok(())
    }
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(4000))]

    #[test]
    fn the_screen_shows_the_stored_words_or_the_persons_own_under_any_order(
        stored in words(),
        acts in proptest::collection::vec(act(), 0..28),
    ) {
        let mut world = World::new(stored);
        for act in &acts {
            world.play(act)?;
        }
        world.settle()?;
        if world.page.unsaved() {
            prop_assert_ne!(world.page.shown(), world.server.clone());
        } else if world.page.shown() == world.page.stored() {
            prop_assert_eq!(
                world.page.shown(),
                world.server.clone(),
                "a screen with no change of the person shows what the check has stored"
            );
        } else {
            // The person unselected every word and that unmark was not saved: their empty
            // line stands, and holds nothing.
            prop_assert!(world.page.shown().is_empty());
        }
    }
}
