# Where the CI test compile spends its time (#909)

Measured 2026-11-03 on `84a06818` (main), Linux, rustc 1.99.1, `CARGO_BUILD_JOBS=4` to match a
4-vCPU runner, on a 20-core machine, so the absolute seconds are lower than CI's. The command is
the `test` step's build: `cargo test --locked --workspace --exclude tc-app --no-run --timings`.
Reports: `ci-test-compile-2026-11-03/cargo-timing-cold.html` (empty `target/`) and
`cargo-timing-warm.html` (the same, after `cargo clean` of every workspace crate: the state a
restored Rust cache leaves, since the cache keeps dependencies and not workspace crates).

| Build | Wall time | Units | Workspace CPU |
|---|---|---|---|
| Cold | 4 min 16 s | 607 | 681 s |
| Warm (dependencies cached) | 2 min 59 s | 224 | 713 s |

The cold build is 77 s (30%) longer. The five crates with the most compile time, summed over their
units in the cold build: `tc-journal` 246 s, `openssl-sys` 139 s (its build script compiles OpenSSL
from source, because `tc-door43` asks git2 for `vendored-openssl` on Linux and macOS), `tc-api` 93 s
(41 s of it the `roundtrip` test binary), `tc-usfm` 49 s, `tc-server` 38 s.

`openssl-sys` starts at 22 s and ends at 161 s, and `libgit2-sys` and everything that depends on it
(`tc-door43`, `tc-app`, `tc-store`) wait for it. It is the one chain no amount of parallelism shortens,
and a cache hit removes it.

## What CI does today

The merge-queue run of 2026-11-02 23:02 (`ci`, run 41542268430) printed "No cache found" in `test 1/2`
and compiled for 8 min. A merge-queue branch can read the default branch's caches (the `builds` job of
the `shell` run restored one saved on main), but the test jobs had none there: a push to main skips the
tests the queue already ran, so only an admin merge ever saved one.

## Changes, and what was measured for each

- Share one cache between the three test jobs and refresh it nightly on main (`cache-warm` in `ci.yml`).
  Measured locally: 4 min 16 s to 2 min 59 s. Not yet measured on CI.
- Only main saves these caches. Queue runs saved 480 MB each under a branch name nothing else can read,
  and the repository's caches stood at 10.9 GB against a 10 GB limit.
- Linker: already `rust-lld`, the default on x86_64 Linux since Rust 1.90 (`ld.lld` is in the link line).
  mold would add nothing. No change.
- `tc-journal`, `tc-api`: no change proposed. `tc-journal` builds at `opt-level = 2` on purpose
  (`Cargo.toml`); lowering it would slow its tests.
