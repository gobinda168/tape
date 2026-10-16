//! SQLite storage. One connection behind a mutex; every query runs on the
//! blocking pool so it never stalls the async runtime.

use std::path::Path;
use std::sync::{Arc, Mutex};

use anyhow::Context;
use rusqlite::{Connection, OptionalExtension, Row, params};

use crate::error::{AppError, AppResult};

const SCHEMA: &str = "
CREATE TABLE IF NOT EXISTS videos (
    id            INTEGER PRIMARY KEY,
    slug          TEXT    NOT NULL UNIQUE,
    title         TEXT    NOT NULL,
    mime          TEXT    NOT NULL,
    size          INTEGER NOT NULL DEFAULT 0,
    duration_ms   INTEGER NOT NULL DEFAULT 0,
    storage       TEXT    NOT NULL CHECK (storage IN ('local', 'drive')),
    file_name     TEXT,
    drive_file_id TEXT,
    has_thumb     INTEGER NOT NULL DEFAULT 0,
    views         INTEGER NOT NULL DEFAULT 0,
    created_at    TEXT    NOT NULL
);
CREATE TABLE IF NOT EXISTS comments (
    id         INTEGER PRIMARY KEY,
    video_id   INTEGER NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
    name       TEXT    NOT NULL,
    body       TEXT    NOT NULL,
    at_ms      INTEGER,
    created_at TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS comments_video_id ON comments(video_id);
";

const VIDEO_COLUMNS: &str = "id, slug, title, mime, size, duration_ms, storage, file_name, \
                             drive_file_id, has_thumb, views, created_at";

/// A row of `videos`.
#[derive(Debug, Clone)]
pub struct VideoRow {
    pub id: i64,
    pub slug: String,
    pub title: String,
    pub mime: String,
    pub size: i64,
    pub duration_ms: i64,
    pub storage: String,
    pub file_name: Option<String>,
    pub drive_file_id: Option<String>,
    pub has_thumb: bool,
    pub views: i64,
    pub created_at: String,
}

impl VideoRow {
    fn from_row(row: &Row<'_>) -> rusqlite::Result<Self> {
        Ok(VideoRow {
            id: row.get(0)?,
            slug: row.get(1)?,
            title: row.get(2)?,
            mime: row.get(3)?,
            size: row.get(4)?,
            duration_ms: row.get(5)?,
            storage: row.get(6)?,
            file_name: row.get(7)?,
            drive_file_id: row.get(8)?,
            has_thumb: row.get(9)?,
            views: row.get(10)?,
            created_at: row.get(11)?,
        })
    }
}

/// Fields for a new `videos` row (the slug is chosen by [`Db::insert_video`]).
#[derive(Debug, Clone)]
pub struct NewVideo {
    pub title: String,
    pub mime: String,
    pub size: i64,
    pub duration_ms: i64,
    pub storage: String,
    pub file_name: Option<String>,
    pub drive_file_id: Option<String>,
    pub has_thumb: bool,
    pub created_at: String,
}

/// A row of `comments`, in its public JSON shape.
#[derive(Debug, Clone, serde::Serialize)]
pub struct CommentRow {
    pub id: i64,
    pub name: String,
    pub body: String,
    pub at_ms: Option<i64>,
    pub created_at: String,
}

impl CommentRow {
    fn from_row(row: &Row<'_>) -> rusqlite::Result<Self> {
        Ok(CommentRow {
            id: row.get(0)?,
            name: row.get(1)?,
            body: row.get(2)?,
            at_ms: row.get(3)?,
            created_at: row.get(4)?,
        })
    }
}

#[derive(Clone)]
pub struct Db {
    conn: Arc<Mutex<Connection>>,
}

impl Db {
    pub fn open(path: &Path) -> anyhow::Result<Self> {
        let conn = Connection::open(path).with_context(|| format!("opening {}", path.display()))?;
        conn.execute_batch(
            "PRAGMA journal_mode = WAL;
             PRAGMA foreign_keys = ON;
             PRAGMA busy_timeout = 5000;",
        )?;
        conn.execute_batch(SCHEMA).context("creating schema")?;
        Ok(Db {
            conn: Arc::new(Mutex::new(conn)),
        })
    }

    /// Runs `f` with the connection on the blocking thread pool.
    async fn call<T, F>(&self, f: F) -> AppResult<T>
    where
        T: Send + 'static,
        F: FnOnce(&mut Connection) -> AppResult<T> + Send + 'static,
    {
        let conn = Arc::clone(&self.conn);
        tokio::task::spawn_blocking(move || {
            let mut guard = conn.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
            f(&mut guard)
        })
        .await
        .map_err(|err| AppError::Internal(anyhow::anyhow!("database task failed: {err}")))?
    }

    /// Inserts a video under a fresh random slug, retrying on the (very
    /// unlikely) slug collision.
    pub async fn insert_video(&self, video: NewVideo) -> AppResult<VideoRow> {
        self.call(move |conn| {
            for _ in 0..8 {
                let slug = crate::random_base62(crate::SLUG_LEN);
                let result = conn.execute(
                    "INSERT INTO videos (slug, title, mime, size, duration_ms, storage, file_name,
                                         drive_file_id, has_thumb, created_at)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
                    params![
                        slug,
                        video.title,
                        video.mime,
                        video.size,
                        video.duration_ms,
                        video.storage,
                        video.file_name,
                        video.drive_file_id,
                        video.has_thumb,
                        video.created_at,
                    ],
                );
                match result {
                    Ok(_) => return get_by_slug(conn, &slug)?.ok_or(AppError::NotFound),
                    Err(rusqlite::Error::SqliteFailure(e, _))
                        if e.code == rusqlite::ErrorCode::ConstraintViolation =>
                    {
                        continue;
                    }
                    Err(err) => return Err(err.into()),
                }
            }
            Err(AppError::Internal(anyhow::anyhow!(
                "could not allocate a unique slug"
            )))
        })
        .await
    }

    /// Records the files of a stored upload once they are in place.
    pub async fn set_files(
        &self,
        id: i64,
        file_name: Option<String>,
        has_thumb: bool,
    ) -> AppResult<VideoRow> {
        self.call(move |conn| {
            conn.execute(
                "UPDATE videos SET file_name = ?1, has_thumb = ?2 WHERE id = ?3",
                params![file_name, has_thumb, id],
            )?;
            get_by_id(conn, id)?.ok_or(AppError::NotFound)
        })
        .await
    }

    pub async fn get_video(&self, slug: String) -> AppResult<Option<VideoRow>> {
        self.call(move |conn| Ok(get_by_slug(conn, &slug)?)).await
    }

    /// All videos, newest first.
    pub async fn list_videos(&self) -> AppResult<Vec<VideoRow>> {
        self.call(|conn| {
            let mut stmt = conn.prepare(&format!(
                "SELECT {VIDEO_COLUMNS} FROM videos ORDER BY id DESC"
            ))?;
            let rows = stmt
                .query_map([], VideoRow::from_row)?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            Ok(rows)
        })
        .await
    }

    pub async fn update_title(&self, slug: String, title: String) -> AppResult<Option<VideoRow>> {
        self.call(move |conn| {
            conn.execute(
                "UPDATE videos SET title = ?1 WHERE slug = ?2",
                params![title, slug],
            )?;
            Ok(get_by_slug(conn, &slug)?)
        })
        .await
    }

    /// Deletes a video row (and its comments). Returns the row that was deleted.
    pub async fn delete_video(&self, slug: String) -> AppResult<Option<VideoRow>> {
        self.call(move |conn| {
            let tx = conn.transaction()?;
            let row = get_by_slug(&tx, &slug)?;
            if row.is_some() {
                tx.execute("DELETE FROM videos WHERE slug = ?1", params![slug])?;
            }
            tx.commit()?;
            Ok(row)
        })
        .await
    }

    pub async fn delete_video_by_id(&self, id: i64) -> AppResult<()> {
        self.call(move |conn| {
            conn.execute("DELETE FROM videos WHERE id = ?1", params![id])?;
            Ok(())
        })
        .await
    }

    /// Adds one view. Returns the new count, or `None` for an unknown slug.
    pub async fn increment_views(&self, slug: String) -> AppResult<Option<i64>> {
        self.call(move |conn| {
            Ok(conn
                .query_row(
                    "UPDATE videos SET views = views + 1 WHERE slug = ?1 RETURNING views",
                    params![slug],
                    |row| row.get(0),
                )
                .optional()?)
        })
        .await
    }

    /// Comments on a video, oldest first.
    pub async fn list_comments(&self, video_id: i64) -> AppResult<Vec<CommentRow>> {
        self.call(move |conn| {
            let mut stmt = conn.prepare(
                "SELECT id, name, body, at_ms, created_at FROM comments
                 WHERE video_id = ?1 ORDER BY id ASC",
            )?;
            let rows = stmt
                .query_map(params![video_id], CommentRow::from_row)?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            Ok(rows)
        })
        .await
    }

    pub async fn insert_comment(
        &self,
        video_id: i64,
        name: String,
        body: String,
        at_ms: Option<i64>,
        created_at: String,
    ) -> AppResult<CommentRow> {
        self.call(move |conn| {
            Ok(conn.query_row(
                "INSERT INTO comments (video_id, name, body, at_ms, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5)
                 RETURNING id, name, body, at_ms, created_at",
                params![video_id, name, body, at_ms, created_at],
                CommentRow::from_row,
            )?)
        })
        .await
    }
}

fn get_by_slug(conn: &Connection, slug: &str) -> rusqlite::Result<Option<VideoRow>> {
    conn.query_row(
        &format!("SELECT {VIDEO_COLUMNS} FROM videos WHERE slug = ?1"),
        params![slug],
        VideoRow::from_row,
    )
    .optional()
}

fn get_by_id(conn: &Connection, id: i64) -> rusqlite::Result<Option<VideoRow>> {
    conn.query_row(
        &format!("SELECT {VIDEO_COLUMNS} FROM videos WHERE id = ?1"),
        params![id],
        VideoRow::from_row,
    )
    .optional()
}
