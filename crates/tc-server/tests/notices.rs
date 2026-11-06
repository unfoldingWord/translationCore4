//! `GET /third-party-notices.txt` serves the one file `--notices` names, so About can show the
//! build's own THIRD-PARTY-NOTICES.txt with no network (#606).
#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    reason = "test code: a failed unwrap is a failed test"
)]

mod common;

use common::{TestServer, stub};
use tc_api::endpoint::NOTICES_PATH;
use tempfile::TempDir;

const NOTICES: &str = "THIRD-PARTY NOTICES\n\n== serde 1.0 (MIT OR Apache-2.0) ==\n";

#[test]
fn the_notices_route_serves_the_file_notices_names() {
    let dir = TempDir::new().unwrap();
    let file = dir.path().join("THIRD-PARTY-NOTICES.txt");
    std::fs::write(&file, NOTICES).unwrap();
    let server = TestServer::start_with(stub(), |config| config.notices = Some(file), false);

    let response = server.get(NOTICES_PATH);
    assert_eq!(response.status, 200);
    assert_eq!(response.body, NOTICES.as_bytes());
    assert_eq!(
        response.header("content-type"),
        Some("text/plain; charset=utf-8")
    );
    for path in [
        "/third-party-notices.txt/",
        "/third-party-notices.txt/x",
        "/THIRD-PARTY-NOTICES.txt",
        "/secret.txt",
    ] {
        assert_eq!(server.get(path).status, 404, "GET {path}");
    }
}

#[test]
fn the_notices_route_is_404_without_a_file() {
    let server = TestServer::start_with(stub(), |_| {}, false);
    assert_eq!(server.get(NOTICES_PATH).status, 404);

    let dir = TempDir::new().unwrap();
    let gone = dir.path().join("THIRD-PARTY-NOTICES.txt");
    let server = TestServer::start_with(stub(), |config| config.notices = Some(gone), false);
    assert_eq!(server.get(NOTICES_PATH).status, 404);
}
