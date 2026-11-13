//! The real sync port (E1a): sync and open from Door43 through unit X's `tc-sync`.

use tc_api::door43::{ProjectName, RepoName, RepoSource, ShareOwner, SharedRepo};
use tc_api::ids::ProjectRef;
use tc_api::jobs::SyncResultView;

use super::SyncPort;
use crate::app::App;
use crate::backend::BoxFuture;
use crate::jobs::{JobCtx, JobEnd, ProgressSink};

pub struct Door43Sync;

impl SyncPort for Door43Sync {
    fn sync(
        &self,
        app: App,
        folder: ProjectRef,
        ctx: JobCtx,
    ) -> BoxFuture<Result<SyncResultView, JobEnd>> {
        Box::pin(async move { app.door43_sync(folder, ctx).await })
    }

    fn share(
        &self,
        app: App,
        folder: ProjectRef,
        owner: ShareOwner,
        name: RepoName,
        progress: ProgressSink,
    ) -> BoxFuture<Result<SharedRepo, JobEnd>> {
        Box::pin(async move { app.door43_share(folder, owner, name, progress).await })
    }

    fn open(
        &self,
        app: App,
        repo: RepoSource,
        name: ProjectName,
        ctx: JobCtx,
    ) -> BoxFuture<Result<ProjectRef, JobEnd>> {
        Box::pin(async move { app.door43_open(repo, name, ctx).await })
    }
}
