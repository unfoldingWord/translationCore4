# Capsules: the sample projects of each frozen format version

`docs/STORAGE.md` §12.3, PLAN P10, #865. One folder per frozen version (`1.0/`), and in it
one folder per capsule, each holding:

| File | What it is |
|---|---|
| `project/` | A sample project as it leaves the app: every file of the project folder but `.git/` and `.tc/`, which are local to one computer (§3.1, §3.6). Written by the build of that format version through the real store, from the fixtures of this repository, never from a person's project. |
| `EXPECT.json` | The projection that build read back through the store: every record with its heads and history, every conflict, every carried placement, every anomaly. |
| `LOCK.sha256` | `sha256sum` lines in binary form (`<hex> *<path>`) of every other file of the capsule, paths relative to the capsule with `/` separators, sorted by the bytes of the path. |

Made by `cargo run -p tc-corpus --example capsule -- write <version> fixtures/capsules/<version>`
(`crates/tc-corpus/examples/capsule.rs`), which refuses a folder that exists. **Nobody changes
a frozen capsule afterwards**: `capsules_match_their_lock` (`crates/tc-corpus/tests/capsules.rs`)
fails when a byte moves, and the other tests there open every capsule with the current build.
A test that needs a capsule to change has found a bug, or a format change that needs a new
version and a new capsule set (§12.2 rule 7).

`FROZEN` in a version's folder names the commit and the date the version was frozen at; the
tag `format-v<version>` points at that commit.

The Bible capsules hold Titus from the unfoldingWord Literal Text (`fixtures/tc4/test-fixtures/en_ult/TIT.usfm`,
CC BY-SA 4.0, © unfoldingWord); the story capsule holds the Open Bible Stories template
(CC BY-SA 4.0, © unfoldingWord). Everything else in them is generated.
