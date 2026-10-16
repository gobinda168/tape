use std::path::PathBuf;

use axum::Router;
use axum::body::Body;
use axum::http::{Request, StatusCode, header};
use http_body_util::BodyExt;
use serde_json::{Value, json};
use tape_server::{AppState, Config, app};
use tempfile::TempDir;
use tower::ServiceExt;

const TOKEN: &str = "test-owner-token-0123456789abcdef";
const PUBLIC_URL: &str = "http://tape.test";
const BOUNDARY: &str = "----tape-test-boundary";
const FAKE_MP4: &[u8] = b"\x00\x00\x00\x18ftypmp42 not really a video, just bytes";
const FAKE_JPEG: &[u8] = b"\xFF\xD8\xFF\xE0 fake jpeg";

struct TestApp {
    router: Router,
    dir: TempDir,
}

impl TestApp {
    fn new() -> Self {
        let dir = tempfile::tempdir().expect("temp dir");
        let config = Config {
            addr: "127.0.0.1:0".parse().unwrap(),
            data_dir: dir.path().to_path_buf(),
            token: TOKEN.to_owned(),
            public_url: PUBLIC_URL.to_owned(),
            google_api_key: None,
            web_dir: PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("web"),
        };
        let state = AppState::new(config).expect("state");
        TestApp {
            router: app(state),
            dir,
        }
    }

    async fn send(&self, req: Request<Body>) -> (StatusCode, axum::http::HeaderMap, Vec<u8>) {
        let res = self.router.clone().oneshot(req).await.expect("response");
        let status = res.status();
        let headers = res.headers().clone();
        let body = res.into_body().collect().await.expect("body").to_bytes();
        (status, headers, body.to_vec())
    }

    async fn json(&self, req: Request<Body>) -> (StatusCode, Value) {
        let (status, _, body) = self.send(req).await;
        let value = if body.is_empty() {
            Value::Null
        } else {
            serde_json::from_slice(&body)
                .unwrap_or_else(|_| panic!("not JSON: {}", String::from_utf8_lossy(&body)))
        };
        (status, value)
    }

    /// Uploads with the given meta and optional video/thumb parts.
    async fn upload(
        &self,
        meta: Value,
        video: Option<&[u8]>,
        thumb: Option<&[u8]>,
    ) -> (StatusCode, Value) {
        // Video first, then meta, to prove field order does not matter.
        let mut parts: Vec<Part> = Vec::new();
        if let Some(bytes) = video {
            parts.push(Part::file("video", "rec.mp4", "video/mp4", bytes));
        }
        parts.push(Part::text("meta", &meta.to_string()));
        if let Some(bytes) = thumb {
            parts.push(Part::file("thumb", "thumb.jpg", "image/jpeg", bytes));
        }
        let req = Request::post("/api/videos")
            .header(header::AUTHORIZATION, format!("Bearer {TOKEN}"))
            .header(
                header::CONTENT_TYPE,
                format!("multipart/form-data; boundary={BOUNDARY}"),
            )
            .body(Body::from(multipart_body(&parts)))
            .unwrap();
        self.json(req).await
    }

    async fn upload_local(&self, title: &str) -> Value {
        let (status, video) = self
            .upload(
                json!({ "title": title, "duration_ms": 4200, "mime": "video/mp4", "storage": "local" }),
                Some(FAKE_MP4),
                Some(FAKE_JPEG),
            )
            .await;
        assert_eq!(status, StatusCode::CREATED, "{video}");
        video
    }
}

struct Part {
    name: &'static str,
    file: Option<(&'static str, &'static str)>,
    data: Vec<u8>,
}

impl Part {
    fn text(name: &'static str, value: &str) -> Self {
        Part {
            name,
            file: None,
            data: value.as_bytes().to_vec(),
        }
    }
    fn file(
        name: &'static str,
        filename: &'static str,
        content_type: &'static str,
        data: &[u8],
    ) -> Self {
        Part {
            name,
            file: Some((filename, content_type)),
            data: data.to_vec(),
        }
    }
}

fn multipart_body(parts: &[Part]) -> Vec<u8> {
    let mut body = Vec::new();
    for part in parts {
        body.extend_from_slice(format!("--{BOUNDARY}\r\n").as_bytes());
        match part.file {
            Some((filename, content_type)) => body.extend_from_slice(
                format!(
                    "Content-Disposition: form-data; name=\"{}\"; filename=\"{filename}\"\r\nContent-Type: {content_type}\r\n\r\n",
                    part.name
                )
                .as_bytes(),
            ),
            None => body.extend_from_slice(
                format!("Content-Disposition: form-data; name=\"{}\"\r\n\r\n", part.name).as_bytes(),
            ),
        }
        body.extend_from_slice(&part.data);
        body.extend_from_slice(b"\r\n");
    }
    body.extend_from_slice(format!("--{BOUNDARY}--\r\n").as_bytes());
    body
}

fn owner(req: axum::http::request::Builder) -> axum::http::request::Builder {
    req.header(header::AUTHORIZATION, format!("Bearer {TOKEN}"))
}

fn get(uri: &str) -> Request<Body> {
    Request::get(uri).body(Body::empty()).unwrap()
}

fn post_json(uri: &str, value: Value) -> Request<Body> {
    Request::post(uri)
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(value.to_string()))
        .unwrap()
}

#[tokio::test]
async fn health_and_root() {
    let t = TestApp::new();
    let (status, body) = t.json(get("/api/health")).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["ok"], true);
    assert_eq!(body["name"], "tape-server");
    assert_eq!(body["version"], env!("CARGO_PKG_VERSION"));

    let (status, body) = t.json(get("/")).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body, json!({ "name": "tape-server", "ok": true }));
}

#[tokio::test]
async fn owner_routes_need_the_token() {
    let t = TestApp::new();
    let (status, body) = t.json(get("/api/me")).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert!(body["error"].is_string());

    let (status, _) = t.json(get("/api/videos")).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);

    let wrong = Request::get("/api/me")
        .header(header::AUTHORIZATION, "Bearer nope")
        .body(Body::empty())
        .unwrap();
    let (status, _) = t.json(wrong).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);

    let (status, body) = t
        .json(owner(Request::get("/api/me")).body(Body::empty()).unwrap())
        .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["ok"], true);
    assert_eq!(body["name"], "tape-server");
}

#[tokio::test]
async fn cors_preflight_allows_extension_origin() {
    let t = TestApp::new();
    let req = Request::options("/api/videos")
        .header(header::ORIGIN, "chrome-extension://abcdefghijklmnop")
        .header(header::ACCESS_CONTROL_REQUEST_METHOD, "POST")
        .header(
            header::ACCESS_CONTROL_REQUEST_HEADERS,
            "authorization,content-type",
        )
        .body(Body::empty())
        .unwrap();
    let (status, headers, _) = t.send(req).await;
    assert!(status.is_success(), "{status}");
    assert_eq!(headers[header::ACCESS_CONTROL_ALLOW_ORIGIN], "*");
    let allowed = headers[header::ACCESS_CONTROL_ALLOW_HEADERS]
        .to_str()
        .unwrap();
    assert!(allowed.contains("authorization"), "{allowed}");
}

#[tokio::test]
async fn upload_list_and_range_media() {
    let t = TestApp::new();
    let video = t.upload_local("Walkthrough").await;
    let slug = video["slug"].as_str().unwrap().to_owned();

    assert_eq!(slug.len(), 10);
    assert!(slug.chars().all(|c| c.is_ascii_alphanumeric()));
    assert_eq!(video["title"], "Walkthrough");
    assert_eq!(video["mime"], "video/mp4");
    assert_eq!(video["size"], FAKE_MP4.len());
    assert_eq!(video["duration_ms"], 4200);
    assert_eq!(video["storage"], "local");
    assert_eq!(video["drive_file_id"], Value::Null);
    assert_eq!(video["views"], 0);
    assert_eq!(video["url"], format!("{PUBLIC_URL}/v/{slug}"));
    assert_eq!(video["media_url"], format!("{PUBLIC_URL}/media/{slug}"));
    assert_eq!(video["thumb_url"], format!("{PUBLIC_URL}/thumb/{slug}"));
    assert_eq!(video["embed_mode"], "video");
    assert!(chrono_like(video["created_at"].as_str().unwrap()));

    // Stored under its slug, with no leftover temp files.
    let stored = t.dir.path().join("videos").join(format!("{slug}.mp4"));
    assert_eq!(std::fs::read(&stored).unwrap(), FAKE_MP4);
    let leftovers: Vec<_> = std::fs::read_dir(t.dir.path().join("videos"))
        .unwrap()
        .filter_map(|e| e.ok())
        .filter(|e| e.file_name().to_string_lossy().ends_with(".part"))
        .collect();
    assert!(leftovers.is_empty());

    // Listed.
    let (status, list) = t
        .json(
            owner(Request::get("/api/videos"))
                .body(Body::empty())
                .unwrap(),
        )
        .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(list.as_array().unwrap().len(), 1);
    assert_eq!(list[0]["slug"], slug.as_str());

    // Public JSON has the same shape.
    let (status, public) = t.json(get(&format!("/api/public/videos/{slug}"))).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(public, video);

    // Range request → 206 with exactly 4 bytes.
    let req = Request::get(format!("/media/{slug}"))
        .header(header::RANGE, "bytes=0-3")
        .body(Body::empty())
        .unwrap();
    let (status, headers, body) = t.send(req).await;
    assert_eq!(status, StatusCode::PARTIAL_CONTENT);
    assert_eq!(body, &FAKE_MP4[0..4]);
    assert_eq!(headers[header::CONTENT_TYPE], "video/mp4");
    assert_eq!(
        headers[header::CONTENT_RANGE],
        format!("bytes 0-3/{}", FAKE_MP4.len()).as_str()
    );
    assert_eq!(headers[header::ACCEPT_RANGES], "bytes");

    // Whole file.
    let (status, _, body) = t.send(get(&format!("/media/{slug}"))).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body, FAKE_MP4);

    // Thumbnail.
    let (status, headers, body) = t.send(get(&format!("/thumb/{slug}"))).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body, FAKE_JPEG);
    assert_eq!(headers[header::CONTENT_TYPE], "image/jpeg");
    assert_eq!(headers[header::CACHE_CONTROL], "public, max-age=3600");
}

fn chrono_like(s: &str) -> bool {
    s.len() >= 20 && s.as_bytes()[4] == b'-' && s.contains('T') && s.ends_with('Z')
}

#[tokio::test]
async fn upload_larger_than_default_body_limit() {
    // axum's default limit is 2 MB; the upload route allows 8 GiB.
    let t = TestApp::new();
    let big = vec![7u8; 5 * 1024 * 1024];
    let (status, video) = t
        .upload(
            json!({ "title": "Big", "duration_ms": 1, "mime": "video/webm", "storage": "local" }),
            Some(&big),
            None,
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{video}");
    assert_eq!(video["size"], big.len());
    assert_eq!(video["thumb_url"], Value::Null);
    let slug = video["slug"].as_str().unwrap();
    let stored = t.dir.path().join("videos").join(format!("{slug}.webm"));
    assert_eq!(std::fs::metadata(stored).unwrap().len(), big.len() as u64);
}

#[tokio::test]
async fn upload_validation() {
    let t = TestApp::new();
    // Local without a video file.
    let (status, body) = t
        .upload(
            json!({ "title": "x", "duration_ms": 1, "mime": "video/webm", "storage": "local" }),
            None,
            None,
        )
        .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert!(body["error"].is_string());

    // Unknown storage.
    let (status, _) = t
        .upload(
            json!({ "title": "x", "duration_ms": 1, "mime": "video/webm", "storage": "s3" }),
            Some(FAKE_MP4),
            None,
        )
        .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);

    // Nothing was stored.
    let (_, list) = t
        .json(
            owner(Request::get("/api/videos"))
                .body(Body::empty())
                .unwrap(),
        )
        .await;
    assert_eq!(list, json!([]));
}

#[tokio::test]
async fn viewer_page_escapes_title() {
    let t = TestApp::new();
    let video = t
        .upload_local("<script>alert(1)</script> & \"quotes\"")
        .await;
    let slug = video["slug"].as_str().unwrap();

    let (status, headers, body) = t.send(get(&format!("/v/{slug}"))).await;
    assert_eq!(status, StatusCode::OK);
    assert!(
        headers[header::CONTENT_TYPE]
            .to_str()
            .unwrap()
            .starts_with("text/html")
    );
    let html = String::from_utf8(body).unwrap();
    assert!(html.contains("&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;quotes&quot;"));
    assert!(!html.contains("<script>alert(1)"));
    assert!(html.contains(&format!("data-slug=\"{slug}\"")));
    assert!(html.contains(&format!("{PUBLIC_URL}/media/{slug}")));
    assert!(!html.contains("{{"), "unfilled placeholder left in page");

    let (status, _, body) = t.send(get("/v/doesnotexist")).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert!(String::from_utf8(body).unwrap().contains("not found"));
}

#[tokio::test]
async fn views_increment() {
    let t = TestApp::new();
    let video = t.upload_local("Views").await;
    let slug = video["slug"].as_str().unwrap();
    let uri = format!("/api/public/videos/{slug}/view");

    let (status, body) = t
        .json(Request::post(&uri).body(Body::empty()).unwrap())
        .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body, json!({ "views": 1 }));
    let (_, body) = t
        .json(Request::post(&uri).body(Body::empty()).unwrap())
        .await;
    assert_eq!(body, json!({ "views": 2 }));

    let (_, public) = t.json(get(&format!("/api/public/videos/{slug}"))).await;
    assert_eq!(public["views"], 2);

    let (status, _) = t
        .json(
            Request::post("/api/public/videos/nope/view")
                .body(Body::empty())
                .unwrap(),
        )
        .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn comments_post_and_list() {
    let t = TestApp::new();
    let video = t.upload_local("Comments").await;
    let slug = video["slug"].as_str().unwrap();
    let uri = format!("/api/public/videos/{slug}/comments");

    let (status, first) = t
        .json(post_json(
            &uri,
            json!({ "name": "  Ada  ", "body": " Nice cut ", "at_ms": 1500 }),
        ))
        .await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(first["name"], "Ada");
    assert_eq!(first["body"], "Nice cut");
    assert_eq!(first["at_ms"], 1500);
    assert!(first["id"].is_i64());
    assert!(first["created_at"].is_string());

    let (status, second) = t
        .json(post_json(&uri, json!({ "name": "", "body": "Second" })))
        .await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(second["name"], "Anonymous");
    assert_eq!(second["at_ms"], Value::Null);

    let (status, list) = t.json(get(&uri)).await;
    assert_eq!(status, StatusCode::OK);
    let list = list.as_array().unwrap();
    assert_eq!(list.len(), 2);
    assert_eq!(list[0]["body"], "Nice cut");
    assert_eq!(list[1]["body"], "Second");
}

#[tokio::test]
async fn comment_validation() {
    let t = TestApp::new();
    let video = t.upload_local("Validation").await;
    let slug = video["slug"].as_str().unwrap();
    let uri = format!("/api/public/videos/{slug}/comments");

    for bad in [
        json!({ "name": "Ada", "body": "   " }),
        json!({ "name": "Ada", "body": "x".repeat(2001) }),
        json!({ "name": "n".repeat(61), "body": "ok" }),
    ] {
        let (status, body) = t.json(post_json(&uri, bad)).await;
        assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
        assert!(body["error"].is_string(), "{body}");
    }

    // Exactly at the limits is fine.
    let (status, _) = t
        .json(post_json(
            &uri,
            json!({ "name": "n".repeat(60), "body": "x".repeat(2000) }),
        ))
        .await;
    assert_eq!(status, StatusCode::CREATED);

    // Unknown video.
    let (status, _) = t
        .json(post_json(
            "/api/public/videos/nope/comments",
            json!({ "body": "hi" }),
        ))
        .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn drive_without_api_key_uses_iframe() {
    let t = TestApp::new();
    let (status, video) = t
        .upload(
            json!({
                "title": "On Drive",
                "duration_ms": 9000,
                "mime": "video/webm",
                "storage": "drive",
                "drive_file_id": "1AbC-dEf_GhIjKlMnOp"
            }),
            None,
            None,
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{video}");
    let slug = video["slug"].as_str().unwrap();
    assert_eq!(video["storage"], "drive");
    assert_eq!(video["drive_file_id"], "1AbC-dEf_GhIjKlMnOp");
    assert_eq!(video["embed_mode"], "drive-iframe");
    assert_eq!(video["media_url"], Value::Null);
    assert_eq!(video["thumb_url"], Value::Null);

    let (status, _, _) = t.send(get(&format!("/media/{slug}"))).await;
    assert_eq!(status, StatusCode::NOT_FOUND);

    let (_, _, body) = t.send(get(&format!("/v/{slug}"))).await;
    let html = String::from_utf8(body).unwrap();
    assert!(html.contains("data-embed-mode=\"drive-iframe\""));
    assert!(html.contains("data-drive-file-id=\"1AbC-dEf_GhIjKlMnOp\""));

    // A bad Drive id is refused.
    let (status, _) = t
        .upload(
            json!({ "title": "x", "duration_ms": 1, "mime": "video/webm", "storage": "drive", "drive_file_id": "../etc" }),
            None,
            None,
        )
        .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn patch_title() {
    let t = TestApp::new();
    let video = t.upload_local("Old").await;
    let slug = video["slug"].as_str().unwrap();
    let uri = format!("/api/videos/{slug}");

    let req = owner(Request::patch(&uri))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({ "title": "  New title " }).to_string()))
        .unwrap();
    let (status, body) = t.json(req).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["title"], "New title");
    assert_eq!(body["slug"], slug);

    // Needs the token.
    let req = Request::patch(&uri)
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({ "title": "Nope" }).to_string()))
        .unwrap();
    let (status, _) = t.json(req).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);

    // Empty title.
    let req = owner(Request::patch(&uri))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({ "title": "  " }).to_string()))
        .unwrap();
    let (status, _) = t.json(req).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);

    let req = owner(Request::patch("/api/videos/nope"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({ "title": "x" }).to_string()))
        .unwrap();
    let (status, _) = t.json(req).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn delete_removes_files_and_rows() {
    let t = TestApp::new();
    let video = t.upload_local("Doomed").await;
    let slug = video["slug"].as_str().unwrap().to_owned();
    let file = t.dir.path().join("videos").join(format!("{slug}.mp4"));
    let thumb = t.dir.path().join("thumbs").join(format!("{slug}.jpg"));
    assert!(file.exists() && thumb.exists());

    t.json(post_json(
        &format!("/api/public/videos/{slug}/comments"),
        json!({ "body": "bye" }),
    ))
    .await;

    let (status, _, body) = t
        .send(
            owner(Request::delete(format!("/api/videos/{slug}")))
                .body(Body::empty())
                .unwrap(),
        )
        .await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    assert!(body.is_empty());
    assert!(!file.exists());
    assert!(!thumb.exists());

    let (status, _) = t.json(get(&format!("/api/public/videos/{slug}"))).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let (status, _, _) = t.send(get(&format!("/media/{slug}"))).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let (_, list) = t
        .json(
            owner(Request::get("/api/videos"))
                .body(Body::empty())
                .unwrap(),
        )
        .await;
    assert_eq!(list, json!([]));

    let (status, _, _) = t
        .send(
            owner(Request::delete(format!("/api/videos/{slug}")))
                .body(Body::empty())
                .unwrap(),
        )
        .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn unknown_route_is_json_404() {
    let t = TestApp::new();
    let (status, body) = t.json(get("/nope")).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(body["error"], "not found");
}
