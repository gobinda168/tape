//! Runtime configuration, read from environment variables.

use std::env;
use std::fs;
use std::io::Write;
use std::net::SocketAddr;
use std::path::{Path, PathBuf};

use anyhow::{Context, Result};

const DEFAULT_ADDR: &str = "127.0.0.1:8787";
const TOKEN_LEN: usize = 32;

/// Everything the server needs to run. Tests build this directly.
#[derive(Debug, Clone)]
pub struct Config {
    /// Socket address to listen on (`TAPE_ADDR`).
    pub addr: SocketAddr,
    /// Holds `tape.db`, `videos/`, `thumbs/` and `token` (`TAPE_DATA_DIR`).
    pub data_dir: PathBuf,
    /// Owner bearer token (`TAPE_TOKEN`, else `DATA_DIR/token`).
    pub token: String,
    /// Base for links, no trailing slash (`TAPE_PUBLIC_URL`).
    pub public_url: String,
    /// Enables proxying public Drive files through `/media/:slug`.
    pub google_api_key: Option<String>,
    /// Holds `viewer.html`, `404.html` and `assets/` (`TAPE_WEB_DIR`).
    pub web_dir: PathBuf,
}

/// Where the owner token came from, so `main` can tell the user.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TokenSource {
    Env,
    File,
    Generated,
}

impl Config {
    /// Reads the environment. Creates the data directory, and the token file
    /// when no token is configured yet.
    pub fn from_env() -> Result<(Self, TokenSource)> {
        let addr_raw = env_var("TAPE_ADDR").unwrap_or_else(|| DEFAULT_ADDR.to_owned());
        let addr: SocketAddr = addr_raw.parse().with_context(|| {
            format!("TAPE_ADDR {addr_raw:?} is not an ip:port address (e.g. 127.0.0.1:8787)")
        })?;

        let data_dir = env_var("TAPE_DATA_DIR")
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from("./data"));
        fs::create_dir_all(&data_dir)
            .with_context(|| format!("creating data dir {}", data_dir.display()))?;

        let (token, source) = match env_var("TAPE_TOKEN") {
            Some(token) => (token, TokenSource::Env),
            None => load_or_create_token(&data_dir)?,
        };

        let public_url = normalize_public_url(
            &env_var("TAPE_PUBLIC_URL").unwrap_or_else(|| format!("http://{addr}")),
        );

        let config = Config {
            addr,
            data_dir,
            token,
            public_url,
            google_api_key: env_var("GOOGLE_API_KEY"),
            web_dir: resolve_web_dir(env_var("TAPE_WEB_DIR")),
        };
        Ok((config, source))
    }

    pub fn db_path(&self) -> PathBuf {
        self.data_dir.join("tape.db")
    }

    pub fn videos_dir(&self) -> PathBuf {
        self.data_dir.join("videos")
    }

    pub fn thumbs_dir(&self) -> PathBuf {
        self.data_dir.join("thumbs")
    }
}

/// A set, non-blank environment variable.
fn env_var(name: &str) -> Option<String> {
    env::var(name)
        .ok()
        .map(|v| v.trim().to_owned())
        .filter(|v| !v.is_empty())
}

/// Strips trailing slashes so links can be built as `{base}/v/{slug}`.
pub fn normalize_public_url(url: &str) -> String {
    url.trim().trim_end_matches('/').to_owned()
}

/// `TAPE_WEB_DIR`, else `./web` relative to the working directory, else the
/// crate's own `web/` directory.
fn resolve_web_dir(from_env: Option<String>) -> PathBuf {
    if let Some(dir) = from_env {
        return PathBuf::from(dir);
    }
    let cwd_web = PathBuf::from("./web");
    if cwd_web.is_dir() {
        return cwd_web;
    }
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("web")
}

fn load_or_create_token(data_dir: &Path) -> Result<(String, TokenSource)> {
    let path = data_dir.join("token");
    match fs::read_to_string(&path) {
        Ok(contents) if !contents.trim().is_empty() => {
            return Ok((contents.trim().to_owned(), TokenSource::File));
        }
        Ok(_) => {}
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => {}
        Err(err) => {
            return Err(err).with_context(|| format!("reading {}", path.display()));
        }
    }

    let token = crate::random_base62(TOKEN_LEN);
    write_private(&path, &token).with_context(|| format!("writing {}", path.display()))?;
    Ok((token, TokenSource::Generated))
}

/// Writes a file readable only by the owner (on Unix).
fn write_private(path: &Path, contents: &str) -> std::io::Result<()> {
    let mut options = fs::OpenOptions::new();
    options.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(path)?;
    writeln!(file, "{contents}")?;
    file.sync_all()
}
