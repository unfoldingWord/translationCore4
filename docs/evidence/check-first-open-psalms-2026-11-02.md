# The first open of the Check screen on Psalms, 2026-11-02

Budget (`docs/PERFORMANCE.md`, Checking): open the Check screen on Psalms tN and tW in 250 ms the
first time. This is a profile from one developer machine, not a figure from the reference laptop,
so it neither confirms nor clears the row (ruling H17, #868).

## What was measured

`check/picker`, the first time, on the Psalms corpus through `book_costs_what_it_touches` with
`OnStore::AppCounts` (`crates/tc-app/tests/op_counts/check.rs`): release build, 4 worker threads,
Windows 11. The project holds saved decisions: about 7,660 for tW and 8,212 for tN, on 7,683 and
7,969 checks.

## Where the time went, before this change

Temporary timers in one run, each figure for one list. The two lists overlap, so these do not add
up to the total.

| Step | tW | tN |
|---|---|---|
| Load the book's resources (shared) | about 60 ms | about 60 ms |
| Derive the list | about 30 ms | about 43 ms |
| Read the decisions (`FoldState::decisions`) | about 150 ms | about 160 ms |
| of which projecting the book's text | about 5 ms | about 5 ms |
| Place the decisions and compute states (`session::open`) | about 17 ms | about 28 ms |
| Build the rail's rows | about 1 ms | about 1 ms |

After both lists, `align::index::progress` took about 100 ms on the async thread, once they had
finished. Total: about 430 ms.

Two costs were structural:

1. `decisions_in` decoded every record of the book, then dropped the verses and the other tool's
   decisions. It now reads the key first. `a_tools_decisions_never_read_the_other_tools`
   (`crates/tc-journal/tests/operation_counts.rs`) proves it: reading the notes' decisions projected
   23,954 records before.
2. The Align card was counted after the two lists. It now runs beside them on the blocking pool.

## Before and after

`git show origin/main:<path>` of the two changed files at `945a354f`, against this change, one
after the other. 5 processes. Each process takes 6 samples, in the harness's order: on the memory
backend, then on the store backend, each on Psalms, the larger corpus and the larger corpus's
Psalms alone. In milliseconds.

| | Samples | Min | Median | Max |
|---|---|---|---|---|
| `main`, every sample | 30 | 441 | 496 | 633 |
| This change, every sample | 30 | 286 | 336 | 504 |
| `main`, Psalms, memory | 5 | 478 | 577 | 602 |
| This change, Psalms, memory | 5 | 320 | 338 | 437 |
| `main`, Psalms, store | 5 | 457 | 486 | 596 |
| This change, Psalms, store | 5 | 297 | 334 | 403 |

**The 250 ms budget was not met in any sample.** Earlier runs on the same day were much slower
and more spread on both sides (a median of about 790 ms on `main` in one), while the machine was
busy, so these figures compare the two sides and do not state a machine's best.

## To reproduce

Temporarily add this test to `crates/tc-app/tests/op_counts/check.rs`:

```rust
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn zz_time_picker() {
    let _ = book_costs_what_it_touches("time", OnStore::AppCounts, opened, async |s: &Scale| {
        let started = std::time::Instant::now();
        let _: tc_api::check::PickerView = ok(&s.app, &tc_api::check::Picker { at: s.scope(), unit: CheckUnit::Book(PSALMS) }).await;
        println!("PICKER_MS {}", started.elapsed().as_millis());
    }).await;
}
```

Then run:

```sh
cargo test --release -p tc-app --test op_counts -- --nocapture --exact op_counts::check::zz_time_picker
```

## Pending

A figure on the reference laptop (#868).
