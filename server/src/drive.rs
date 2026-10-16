//! Streams a public Google Drive file through `/media/:slug`, so Drive-stored
//! recordings play in a plain `<video>` element with seeking.

use axum::body::Body;
use axum::http::{HeaderMap, Response, StatusCode, header};

use crate::error::{AppError, AppResult};

const DRIVE_FILES_URL: &str = "https://www.googleapis.com/drive/v3/files";

/// Headers copied from Google's response to ours.
const PASSTHROUGH_HEADERS: [header::HeaderName; 4] = [
    header::CONTENT_TYPE,
    header::CONTENT_LENGTH,
    header::CONTENT_RANGE,
    header::ACCEPT_RANGES,
];

/// Drive file ids are URL-safe base64-ish; anything else is rejected up front.
pub fn is_valid_file_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 200
        && id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

/// Fetches `file_id` with `alt=media`, forwarding the caller's `Range` header,
/// and streams the body back with the status and range headers intact.
pub async fn proxy(
    client: &reqwest::Client,
    api_key: &str,
    file_id: &str,
    fallback_mime: &str,
    incoming: &HeaderMap,
) -> AppResult<Response<Body>> {
    if !is_valid_file_id(file_id) {
        return Err(AppError::NotFound);
    }

    let mut url = reqwest::Url::parse(DRIVE_FILES_URL).expect("static URL parses");
    url.path_segments_mut()
        .expect("https URL has path segments")
        .push(file_id);
    url.query_pairs_mut()
        .append_pair("alt", "media")
        .append_pair("key", api_key);

    let mut request = client.get(url);
    if let Some(range) = incoming.get(header::RANGE) {
        request = request.header(header::RANGE, range.clone());
    }

    let upstream = request
        .send()
        .await
        .map_err(|err| AppError::BadGateway(format!("Drive request failed: {err}")))?;

    let status = upstream.status();
    match status {
        StatusCode::OK | StatusCode::PARTIAL_CONTENT => {}
        StatusCode::RANGE_NOT_SATISFIABLE => {
            let mut response = Response::builder().status(status);
            if let Some(value) = upstream.headers().get(header::CONTENT_RANGE) {
                response = response.header(header::CONTENT_RANGE, value.clone());
            }
            return response
                .body(Body::empty())
                .map_err(|err| AppError::Internal(err.into()));
        }
        StatusCode::NOT_FOUND | StatusCode::FORBIDDEN | StatusCode::UNAUTHORIZED => {
            tracing::warn!(%status, file_id, "Drive refused the file (not public, or bad API key)");
            return Err(AppError::NotFound);
        }
        other => {
            return Err(AppError::BadGateway(format!("Drive answered {other}")));
        }
    }

    let mut response = Response::builder().status(status);
    for name in PASSTHROUGH_HEADERS {
        if let Some(value) = upstream.headers().get(&name) {
            response = response.header(name, value.clone());
        }
    }
    if !upstream.headers().contains_key(header::CONTENT_TYPE) {
        response = response.header(header::CONTENT_TYPE, fallback_mime);
    }
    if !upstream.headers().contains_key(header::ACCEPT_RANGES) {
        response = response.header(header::ACCEPT_RANGES, "bytes");
    }

    response
        .body(Body::from_stream(upstream.bytes_stream()))
        .map_err(|err| AppError::Internal(err.into()))
}
