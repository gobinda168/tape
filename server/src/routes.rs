//! HTTP routes: the owner API (bearer token), the public share API, share
//! pages, media and thumbnails.

use std::path::{Path, PathBuf};
use std::time::Duration;

use axum::body::Body;
use axum::extract::multipart::Field;
use axum::extract::rejection::JsonRejection;
use axum::extract::{DefaultBodyLimit, Multipart, Path as UrlPath, Request, State};
use axum::handler::Handler;
use axum::http::{HeaderValue, Method, StatusCode, header};
use axum::middleware::{self, Next};
use axum::response::{Html, IntoResponse, Response};
use axum::routing::{get, patch, post};
use axum::{Json, Router};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use tokio::io::AsyncWriteExt;
use tower::ServiceExt;
use tower_http::cors::{Any, CorsLayer};
use tower_http::services::{ServeDir, ServeFile};
use tower_http::trace::{DefaultMakeSpan, DefaultOnResponse, TraceLayer};
use tracing::Level;

use crate::db::{CommentRow, NewVideo, VideoRow};
use crate::error::{AppError, AppResult};
use crate::{AppState, NAME, VERSION, drive, random_base62};

/// Body limit for `POST /api/videos` (8 GiB). Other routes keep axum's default.
const UPLOAD_LIMIT: u64 = 8 * 1024 * 1024 * 1024;
/// Largest accepted thumbnail.
const THUMB_LIMIT: u64 = 10 * 1024 * 1024;
const TITLE_MAX_CHARS: usize = 300;
const DEFAULT_TITLE: &str = "Untitled recording";
const COMMENT_NAME_MAX: usize = 60;
const COMMENT_BODY_MAX: usize = 2000;

/// Builds the whole application router.
pub fn app(state: AppState) -> Router {
    let upload_limit = usize::try_from(UPLOAD_LIMIT).unwrap_or(usize::MAX);

    let owner = Router::new()
        .route("/api/me", get(me))
        .route(
            "/api/videos",
            get(list_videos).post(upload_video.layer(DefaultBodyLimit::max(upload_limit))),
        )
        .route(
            "/api/videos/{slug}",
            patch(update_video).delete(delete_video),
        )
        .route_layer(middleware::from_fn_with_state(state.clone(), require_owner));

    let public = Router::new()
        .route("/", get(root))
        .route("/api/health", get(health))
        .route("/v/{slug}", get(viewer))
        .route("/api/public/videos/{slug}", get(public_video))
        .route("/api/public/videos/{slug}/view", post(record_view))
        .route(
            "/api/public/videos/{slug}/comments",
            get(list_comments).post(create_comment),
        )
        .route("/media/{slug}", get(media))
        .route("/thumb/{slug}", get(thumb))
        .nest_service(
            "/assets",
            ServeDir::new(state.config.web_dir.join("assets")),
        );

    owner
        .merge(public)
        .fallback(not_found_json)
        .layer(
            TraceLayer::new_for_http()
                .make_span_with(DefaultMakeSpan::new().level(Level::INFO))
                .on_response(DefaultOnResponse::new().level(Level::INFO)),
        )
        .layer(cors())
        .with_state(state)
}

/// Any origin may call the API: the extension calls the owner API from a
/// `chrome-extension://` origin and share pages may be embedded anywhere.
/// Credentials are never cookies, so a wildcard origin is safe.
fn cors() -> CorsLayer {
    CorsLayer::new()
        .allow_origin(Any)
        .allow_methods([
            Method::GET,
            Method::POST,
            Method::PATCH,
            Method::DELETE,
            Method::OPTIONS,
        ])
        .allow_headers([header::AUTHORIZATION, header::CONTENT_TYPE, header::RANGE])
        .expose_headers([
            header::CONTENT_LENGTH,
            header::CONTENT_RANGE,
            header::ACCEPT_RANGES,
        ])
        .max_age(Duration::from_secs(3600))
}

// ---------------------------------------------------------------------------
// Video JSON
// ---------------------------------------------------------------------------

/// The video shape every endpoint returns.
#[derive(Debug, Serialize)]
pub struct VideoJson {
    pub slug: String,
    pub title: String,
    pub mime: String,
    pub size: i64,
    pub duration_ms: i64,
    pub storage: String,
    pub drive_file_id: Option<String>,
    pub views: i64,
    pub created_at: String,
    pub url: String,
    pub media_url: Option<String>,
    pub thumb_url: Option<String>,
    pub embed_mode: &'static str,
}

impl AppState {
    /// Whether `/media/:slug` can play this video.
    fn playable_by_us(&self, video: &VideoRow) -> bool {
        match video.storage.as_str() {
            "local" => true,
            "drive" => self.config.google_api_key.is_some() && video.drive_file_id.is_some(),
            _ => false,
        }
    }

    fn video_json(&self, video: VideoRow) -> VideoJson {
        let base = &self.config.public_url;
        let playable = self.playable_by_us(&video);
        VideoJson {
            url: format!("{base}/v/{}", video.slug),
            media_url: playable.then(|| format!("{base}/media/{}", video.slug)),
            thumb_url: video
                .has_thumb
                .then(|| format!("{base}/thumb/{}", video.slug)),
            embed_mode: if playable { "video" } else { "drive-iframe" },
            slug: video.slug,
            title: video.title,
            mime: video.mime,
            size: video.size,
            duration_ms: video.duration_ms,
            storage: video.storage,
            drive_file_id: video.drive_file_id,
            views: video.views,
            created_at: video.created_at,
        }
    }

    async fn find_video(&self, slug: String) -> AppResult<VideoRow> {
        self.db.get_video(slug).await?.ok_or(AppError::NotFound)
    }
}

fn now_rfc3339() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

/// Rejects requests without `Authorization: Bearer <owner token>`.
async fn require_owner(State(state): State<AppState>, req: Request, next: Next) -> Response {
    let authorized = req
        .headers()
        .get(header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.trim().split_once(' '))
        .filter(|(scheme, _)| scheme.eq_ignore_ascii_case("bearer"))
        .is_some_and(|(_, token)| {
            constant_time_eq(token.trim().as_bytes(), state.config.token.as_bytes())
        });
    if !authorized {
        return AppError::Unauthorized.into_response();
    }
    next.run(req).await
}

/// Compares without short-circuiting on the first differing byte.
fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let diff = a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y));
    std::hint::black_box(diff) == 0
}

// ---------------------------------------------------------------------------
// Info
// ---------------------------------------------------------------------------

async fn root() -> Json<Value> {
    Json(json!({ "name": NAME, "ok": true }))
}

async fn health() -> Json<Value> {
    Json(json!({ "ok": true, "name": NAME, "version": VERSION }))
}

async fn me() -> Json<Value> {
    Json(json!({ "ok": true, "name": NAME, "version": VERSION }))
}

async fn not_found_json() -> AppError {
    AppError::NotFound
}

// ---------------------------------------------------------------------------
// Owner: upload
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
struct UploadMeta {
    #[serde(default)]
    title: String,
    #[serde(default)]
    duration_ms: f64,
    mime: String,
    storage: String,
    #[serde(default)]
    drive_file_id: Option<String>,
    /// Only used for Drive uploads, where the server never sees the bytes.
    #[serde(default)]
    size: Option<f64>,
}

/// A file being written; removed on drop unless kept.
struct TempFile {
    path: PathBuf,
    keep: bool,
}

impl TempFile {
    fn new(dir: &Path) -> Self {
        TempFile {
            path: dir.join(format!(".upload-{}.part", random_base62(16))),
            keep: false,
        }
    }
}

impl Drop for TempFile {
    fn drop(&mut self) {
        if !self.keep {
            let _ = std::fs::remove_file(&self.path);
        }
    }
}

/// Streams one multipart field to `path` chunk by chunk. Returns bytes written.
async fn stream_field_to_file(
    mut field: Field<'_>,
    path: &Path,
    limit: Option<u64>,
) -> AppResult<u64> {
    let mut file = tokio::fs::File::create(path).await?;
    let mut written: u64 = 0;
    while let Some(chunk) = field.chunk().await? {
        written += chunk.len() as u64;
        if let Some(max) = limit
            && written > max
        {
            return Err(AppError::PayloadTooLarge(format!(
                "file is larger than {max} bytes"
            )));
        }
        file.write_all(&chunk).await?;
    }
    file.flush().await?;
    Ok(written)
}

fn extension_for_mime(mime: &str) -> &'static str {
    let essence = mime.split(';').next().unwrap_or("").trim();
    if essence.eq_ignore_ascii_case("video/mp4") {
        "mp4"
    } else if essence.eq_ignore_ascii_case("video/webm") {
        "webm"
    } else {
        "bin"
    }
}

fn clean_title(raw: &str) -> String {
    let title = raw.trim();
    if title.is_empty() {
        DEFAULT_TITLE.to_owned()
    } else {
        title.chars().take(TITLE_MAX_CHARS).collect()
    }
}

/// `POST /api/videos` (multipart: `meta`, `video`, optional `thumb`, any order).
async fn upload_video(
    State(state): State<AppState>,
    mut multipart: Multipart,
) -> AppResult<(StatusCode, Json<VideoJson>)> {
    let videos_dir = state.config.videos_dir();
    let thumbs_dir = state.config.thumbs_dir();

    let mut meta: Option<UploadMeta> = None;
    let mut video: Option<(TempFile, u64)> = None;
    let mut thumb: Option<TempFile> = None;

    while let Some(field) = multipart.next_field().await? {
        let name = field.name().unwrap_or_default().to_owned();
        match name.as_str() {
            "meta" => {
                let text = field.text().await?;
                let parsed = serde_json::from_str(&text)
                    .map_err(|err| AppError::BadRequest(format!("invalid meta JSON: {err}")))?;
                meta = Some(parsed);
            }
            "video" => {
                if video.is_some() {
                    return Err(AppError::BadRequest("more than one video field".into()));
                }
                let tmp = TempFile::new(&videos_dir);
                let size = stream_field_to_file(field, &tmp.path, None).await?;
                video = Some((tmp, size));
            }
            "thumb" => {
                if thumb.is_some() {
                    return Err(AppError::BadRequest("more than one thumb field".into()));
                }
                if let Some(content_type) = field.content_type()
                    && !content_type.starts_with("image/")
                    && content_type != "application/octet-stream"
                {
                    return Err(AppError::BadRequest(format!(
                        "thumb must be an image, got {content_type}"
                    )));
                }
                let tmp = TempFile::new(&thumbs_dir);
                stream_field_to_file(field, &tmp.path, Some(THUMB_LIMIT)).await?;
                thumb = Some(tmp);
            }
            // Unknown fields are skipped; the next `next_field` drains them.
            _ => {}
        }
    }

    let meta = meta.ok_or_else(|| AppError::BadRequest("missing meta field".into()))?;

    let mime = meta.mime.trim().to_owned();
    if mime.is_empty()
        || mime.len() > 200
        || !mime.contains('/')
        || HeaderValue::from_str(&mime).is_err()
    {
        return Err(AppError::BadRequest(format!("invalid mime {mime:?}")));
    }

    if !meta.duration_ms.is_finite() || meta.duration_ms < 0.0 {
        return Err(AppError::BadRequest(
            "duration_ms must be a positive number".into(),
        ));
    }
    let duration_ms = meta.duration_ms.round() as i64;

    let (storage, size, drive_file_id, video_tmp) = match meta.storage.as_str() {
        "local" => {
            let (tmp, size) = video.ok_or_else(|| {
                AppError::BadRequest("storage \"local\" needs a video file field".into())
            })?;
            let size = i64::try_from(size).unwrap_or(i64::MAX);
            ("local", size, None, Some(tmp))
        }
        "drive" => {
            let id = meta.drive_file_id.as_deref().map(str::trim).unwrap_or("");
            if !drive::is_valid_file_id(id) {
                return Err(AppError::BadRequest(
                    "storage \"drive\" needs a valid drive_file_id".into(),
                ));
            }
            // The bytes live in Drive; a video field sent anyway is discarded.
            drop(video);
            let size = meta
                .size
                .filter(|s| s.is_finite() && *s >= 0.0)
                .map_or(0, |s| s.round() as i64);
            ("drive", size, Some(id.to_owned()), None)
        }
        other => {
            return Err(AppError::BadRequest(format!(
                "storage must be \"local\" or \"drive\", got {other:?}"
            )));
        }
    };

    let row = state
        .db
        .insert_video(NewVideo {
            title: clean_title(&meta.title),
            mime: mime.clone(),
            size,
            duration_ms,
            storage: storage.to_owned(),
            file_name: None,
            drive_file_id,
            has_thumb: false,
            created_at: now_rfc3339(),
        })
        .await?;

    // Move the temp files to their final, slug-based names.
    let video_name = video_tmp
        .as_ref()
        .map(|_| format!("{}.{}", row.slug, extension_for_mime(&mime)));
    let thumb_path = thumbs_dir.join(format!("{}.jpg", row.slug));

    let placed: AppResult<VideoRow> = async {
        if let (Some(mut tmp), Some(name)) = (video_tmp, video_name.as_ref()) {
            tokio::fs::rename(&tmp.path, videos_dir.join(name)).await?;
            tmp.keep = true;
        }
        let has_thumb = if let Some(mut tmp) = thumb {
            tokio::fs::rename(&tmp.path, &thumb_path).await?;
            tmp.keep = true;
            true
        } else {
            false
        };
        state
            .db
            .set_files(row.id, video_name.clone(), has_thumb)
            .await
    }
    .await;

    match placed {
        Ok(row) => Ok((StatusCode::CREATED, Json(state.video_json(row)))),
        Err(err) => {
            if let Some(name) = &video_name {
                let _ = tokio::fs::remove_file(videos_dir.join(name)).await;
            }
            let _ = tokio::fs::remove_file(&thumb_path).await;
            let _ = state.db.delete_video_by_id(row.id).await;
            Err(err)
        }
    }
}

// ---------------------------------------------------------------------------
// Owner: list, rename, delete
// ---------------------------------------------------------------------------

async fn list_videos(State(state): State<AppState>) -> AppResult<Json<Vec<VideoJson>>> {
    let rows = state.db.list_videos().await?;
    Ok(Json(
        rows.into_iter().map(|row| state.video_json(row)).collect(),
    ))
}

#[derive(Debug, Deserialize)]
struct UpdateVideo {
    title: String,
}

async fn update_video(
    State(state): State<AppState>,
    UrlPath(slug): UrlPath<String>,
    body: Result<Json<UpdateVideo>, JsonRejection>,
) -> AppResult<Json<VideoJson>> {
    let Json(update) = body?;
    let title = update.title.trim();
    if title.is_empty() {
        return Err(AppError::Unprocessable("title must not be empty".into()));
    }
    if title.chars().count() > TITLE_MAX_CHARS {
        return Err(AppError::Unprocessable(format!(
            "title must be at most {TITLE_MAX_CHARS} characters"
        )));
    }
    let row = state
        .db
        .update_title(slug, title.to_owned())
        .await?
        .ok_or(AppError::NotFound)?;
    Ok(Json(state.video_json(row)))
}

async fn delete_video(
    State(state): State<AppState>,
    UrlPath(slug): UrlPath<String>,
) -> AppResult<StatusCode> {
    let row = state
        .db
        .delete_video(slug)
        .await?
        .ok_or(AppError::NotFound)?;
    if let Some(name) = &row.file_name {
        remove_if_exists(&state.config.videos_dir().join(name)).await?;
    }
    remove_if_exists(&state.config.thumbs_dir().join(format!("{}.jpg", row.slug))).await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn remove_if_exists(path: &Path) -> AppResult<()> {
    match tokio::fs::remove_file(path).await {
        Ok(()) => Ok(()),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(err) => Err(err.into()),
    }
}

// ---------------------------------------------------------------------------
// Public: share page
// ---------------------------------------------------------------------------

fn escape_html(raw: &str) -> String {
    let mut out = String::with_capacity(raw.len());
    for c in raw.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&#39;"),
            c => out.push(c),
        }
    }
    out
}

/// `GET /v/:slug`: `viewer.html` with its placeholders filled in.
async fn viewer(State(state): State<AppState>, UrlPath(slug): UrlPath<String>) -> Response {
    let row = match state.db.get_video(slug).await {
        Ok(Some(row)) => row,
        Ok(None) => return not_found_page(&state).await,
        Err(err) => return err.into_response(),
    };

    let template_path = state.config.web_dir.join("viewer.html");
    let template = match tokio::fs::read_to_string(&template_path).await {
        Ok(template) => template,
        Err(err) => {
            return AppError::Internal(anyhow::anyhow!(
                "reading {}: {err}",
                template_path.display()
            ))
            .into_response();
        }
    };

    let video = state.video_json(row);
    let duration = video.duration_ms.to_string();
    let replacements: [(&str, &str); 11] = [
        ("{{TITLE}}", &video.title),
        ("{{SLUG}}", &video.slug),
        ("{{PAGE_URL}}", &video.url),
        ("{{MEDIA_URL}}", video.media_url.as_deref().unwrap_or("")),
        ("{{THUMB_URL}}", video.thumb_url.as_deref().unwrap_or("")),
        ("{{CREATED_ISO}}", &video.created_at),
        ("{{DURATION_MS}}", &duration),
        ("{{STORAGE}}", &video.storage),
        (
            "{{DRIVE_FILE_ID}}",
            video.drive_file_id.as_deref().unwrap_or(""),
        ),
        ("{{EMBED_MODE}}", video.embed_mode),
        ("{{MIME}}", &video.mime),
    ];
    let mut page = template;
    for (placeholder, value) in replacements {
        page = page.replace(placeholder, &escape_html(value));
    }

    ([(header::CACHE_CONTROL, "no-cache")], Html(page)).into_response()
}

async fn not_found_page(state: &AppState) -> Response {
    match tokio::fs::read_to_string(state.config.web_dir.join("404.html")).await {
        Ok(page) => (StatusCode::NOT_FOUND, Html(page)).into_response(),
        Err(_) => (StatusCode::NOT_FOUND, "Not found").into_response(),
    }
}

// ---------------------------------------------------------------------------
// Public: video API, media, thumbnails, views, comments
// ---------------------------------------------------------------------------

async fn public_video(
    State(state): State<AppState>,
    UrlPath(slug): UrlPath<String>,
) -> AppResult<Json<VideoJson>> {
    let row = state.find_video(slug).await?;
    Ok(Json(state.video_json(row)))
}

/// `GET /media/:slug`: the local file with Range support, or the Drive proxy.
async fn media(
    State(state): State<AppState>,
    UrlPath(slug): UrlPath<String>,
    req: Request,
) -> AppResult<Response> {
    let row = state.find_video(slug).await?;
    match row.storage.as_str() {
        "local" => {
            let file_name = row.file_name.as_deref().ok_or(AppError::NotFound)?;
            let path = state.config.videos_dir().join(file_name);
            let mut response = match ServeFile::new(path).oneshot(req).await {
                Ok(response) => response,
                Err(never) => match never {},
            };
            if response.status().is_success()
                && let Ok(value) = HeaderValue::from_str(&row.mime)
            {
                response.headers_mut().insert(header::CONTENT_TYPE, value);
            }
            Ok(response.map(Body::new))
        }
        "drive" => match (&state.config.google_api_key, &row.drive_file_id) {
            (Some(key), Some(file_id)) => {
                drive::proxy(&state.http, key, file_id, &row.mime, req.headers()).await
            }
            _ => Err(AppError::NotFound),
        },
        _ => Err(AppError::NotFound),
    }
}

/// Thumbnails are stored as uploaded; the type is sniffed from magic bytes.
fn sniff_image_type(bytes: &[u8]) -> &'static str {
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        "image/png"
    } else if bytes.len() >= 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        "image/webp"
    } else {
        "image/jpeg"
    }
}

async fn thumb(
    State(state): State<AppState>,
    UrlPath(slug): UrlPath<String>,
) -> AppResult<Response> {
    let row = state.find_video(slug).await?;
    if !row.has_thumb {
        return Err(AppError::NotFound);
    }
    let path = state.config.thumbs_dir().join(format!("{}.jpg", row.slug));
    let bytes = match tokio::fs::read(&path).await {
        Ok(bytes) => bytes,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Err(AppError::NotFound),
        Err(err) => return Err(err.into()),
    };
    Ok((
        [
            (header::CONTENT_TYPE, sniff_image_type(&bytes)),
            (header::CACHE_CONTROL, "public, max-age=3600"),
        ],
        bytes,
    )
        .into_response())
}

async fn record_view(
    State(state): State<AppState>,
    UrlPath(slug): UrlPath<String>,
) -> AppResult<Json<Value>> {
    let views = state
        .db
        .increment_views(slug)
        .await?
        .ok_or(AppError::NotFound)?;
    Ok(Json(json!({ "views": views })))
}

async fn list_comments(
    State(state): State<AppState>,
    UrlPath(slug): UrlPath<String>,
) -> AppResult<Json<Vec<CommentRow>>> {
    let video = state.find_video(slug).await?;
    Ok(Json(state.db.list_comments(video.id).await?))
}

#[derive(Debug, Deserialize)]
struct NewComment {
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    body: String,
    #[serde(default)]
    at_ms: Option<f64>,
}

async fn create_comment(
    State(state): State<AppState>,
    UrlPath(slug): UrlPath<String>,
    body: Result<Json<NewComment>, JsonRejection>,
) -> AppResult<(StatusCode, Json<CommentRow>)> {
    let Json(input) = body?;
    let video = state.find_video(slug).await?;

    let name = input.name.as_deref().map(str::trim).unwrap_or("");
    let name = if name.is_empty() { "Anonymous" } else { name };
    if name.chars().count() > COMMENT_NAME_MAX {
        return Err(AppError::Unprocessable(format!(
            "name must be 1 to {COMMENT_NAME_MAX} characters"
        )));
    }

    let text = input.body.trim();
    let text_len = text.chars().count();
    if text_len == 0 || text_len > COMMENT_BODY_MAX {
        return Err(AppError::Unprocessable(format!(
            "body must be 1 to {COMMENT_BODY_MAX} characters"
        )));
    }

    let at_ms = match input.at_ms {
        None => None,
        Some(ms) if ms.is_finite() && ms >= 0.0 => Some(ms.round() as i64),
        Some(_) => {
            return Err(AppError::Unprocessable(
                "at_ms must be a positive number of milliseconds".into(),
            ));
        }
    };

    let comment = state
        .db
        .insert_comment(
            video.id,
            name.to_owned(),
            text.to_owned(),
            at_ms,
            now_rfc3339(),
        )
        .await?;
    Ok((StatusCode::CREATED, Json(comment)))
}
