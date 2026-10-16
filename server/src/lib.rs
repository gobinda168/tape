//! Tape share server: stores recordings (or points at the owner's Google
//! Drive), serves share pages, media with range requests, views and comments.

pub mod config;
pub mod db;
pub mod drive;
pub mod error;
pub mod routes;

use std::sync::Arc;
use std::time::Duration;

use anyhow::Context;
use rand::RngExt;

pub use config::{Config, TokenSource};
pub use routes::app;

pub const NAME: &str = "tape-server";
pub const VERSION: &str = env!("CARGO_PKG_VERSION");

pub(crate) const SLUG_LEN: usize = 10;

const BASE62: &[u8] = b"0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

/// A random string of `len` base62 characters from the thread-local CSPRNG.
pub(crate) fn random_base62(len: usize) -> String {
    let mut rng = rand::rng();
    (0..len)
        .map(|_| BASE62[rng.random_range(0..BASE62.len())] as char)
        .collect()
}

/// Shared state handed to every handler.
#[derive(Clone)]
pub struct AppState {
    pub config: Arc<Config>,
    pub db: db::Db,
    pub http: reqwest::Client,
}

impl AppState {
    /// Creates the data directories, opens (or creates) the database and
    /// builds the HTTP client used for the Drive proxy.
    pub fn new(config: Config) -> anyhow::Result<Self> {
        for dir in [config.videos_dir(), config.thumbs_dir()] {
            std::fs::create_dir_all(&dir).with_context(|| format!("creating {}", dir.display()))?;
        }
        let db = db::Db::open(&config.db_path())?;
        let http = reqwest::Client::builder()
            .user_agent(concat!("tape-server/", env!("CARGO_PKG_VERSION")))
            .connect_timeout(Duration::from_secs(10))
            .build()
            .context("building HTTP client")?;
        Ok(AppState {
            config: Arc::new(config),
            db,
            http,
        })
    }
}
