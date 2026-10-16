# tape-server

A small self-hosted share server for [Tape](../), the browser-extension screen
recorder. The extension works without it; the server adds share links with a
viewer page, view counts and timestamped comments.

Recordings stay on storage you own:

- **local**: the extension uploads the file and it is stored on this server's
  disk (`DATA_DIR/videos/`), streamed back with HTTP range requests so seeking
  works.
- **drive**: the file stays in your Google Drive; the server only keeps its
  metadata. With `GOOGLE_API_KEY` set, a publicly shared Drive file is
  streamed through `/media/:slug` into a normal `<video>` player; without it,
  the share page embeds Google's own Drive preview iframe.

One binary, one SQLite file (`tape.db`, WAL mode), no other services.

## Run

```sh
cargo run --release
```

On first start the server generates an owner token, saves it to
`DATA_DIR/token` and prints it:

```
tape-server 0.1.0 listening on http://127.0.0.1:8787
Owner token: 3kQx...   (new, saved to ./data/token)
```

Tests: `cargo test`. Lint: `cargo clippy --all-targets -- -D warnings`.

## Configuration

| Variable          | Default                         | Meaning |
|-------------------|---------------------------------|---------|
| `TAPE_ADDR`       | `127.0.0.1:8787`                | `ip:port` to listen on. Use `0.0.0.0:8787` to listen on all interfaces. |
| `TAPE_DATA_DIR`   | `./data`                        | Holds `tape.db`, `videos/`, `thumbs/` and `token`. |
| `TAPE_TOKEN`      | contents of `DATA_DIR/token`, else generated | Owner bearer token for the `/api/me` and `/api/videos` routes. |
| `TAPE_PUBLIC_URL` | `http://<TAPE_ADDR>`            | Base for every link the server returns (`url`, `media_url`, `thumb_url`). No trailing slash. Set this to your public HTTPS origin. |
| `GOOGLE_API_KEY`  | unset                           | Enables streaming public Drive files through `/media/:slug`. |
| `TAPE_WEB_DIR`    | `./web`, else the crate's `web/` | Holds `viewer.html`, `404.html` and `assets/`. |
| `RUST_LOG`        | `tape_server=info,tower_http=info` | Log filter. |

## Connecting the extension

In the Tape extension open **Settings → Tape server** and enter:

- **URL**: the server's public URL (the same value as `TAPE_PUBLIC_URL`), e.g.
  `https://tape.example.com`
- **Owner token**: the token printed on first start (or `TAPE_TOKEN`)

The extension checks the connection with `GET /api/me`, then uploads with
`POST /api/videos` and copies the returned `url` to the clipboard.

## API

All responses are JSON unless noted. Errors are `{"error": "..."}`.
CORS allows any origin (the extension calls from `chrome-extension://`), with
`GET, POST, PATCH, DELETE, OPTIONS` and the `Authorization`, `Content-Type`
and `Range` headers.

### Video JSON

Every endpoint that returns a video uses this shape:

```json
{
  "slug": "2tC23UBMxs",
  "title": "Walkthrough",
  "mime": "video/webm",
  "size": 1048576,
  "duration_ms": 42000,
  "storage": "local",
  "drive_file_id": null,
  "views": 3,
  "created_at": "2026-10-16T16:05:22.421Z",
  "url": "https://tape.example.com/v/2tC23UBMxs",
  "media_url": "https://tape.example.com/media/2tC23UBMxs",
  "thumb_url": "https://tape.example.com/thumb/2tC23UBMxs",
  "embed_mode": "video"
}
```

`embed_mode` is `"video"` when `media_url` plays in a `<video>` (local files,
or Drive files when `GOOGLE_API_KEY` is set) and `"drive-iframe"` otherwise
(then `media_url` is `null`; embed `https://drive.google.com/file/d/<drive_file_id>/preview`).

### Owner (needs `Authorization: Bearer <token>`)

| Method & path              | Body | Response |
|----------------------------|------|----------|
| `GET /api/me`              | | `{"ok": true, "name": "tape-server", "version": "0.1.0"}` |
| `POST /api/videos`         | multipart, see below | `201` Video JSON |
| `GET /api/videos`          | | `[Video JSON]`, newest first |
| `PATCH /api/videos/:slug`  | `{"title": "..."}` | Video JSON |
| `DELETE /api/videos/:slug` | | `204`; removes the files, the row and its comments |

`POST /api/videos` takes `multipart/form-data` (up to 8 GiB) with fields in
any order:

- `meta` (text, JSON): `{"title": string, "duration_ms": number, "mime": string, "storage": "local" | "drive", "drive_file_id"?: string, "size"?: number}`
- `video` (file): required when `storage` is `local`. Streamed to disk chunk
  by chunk, stored as `videos/<slug>.mp4|webm|bin` by `mime`.
- `thumb` (file, optional): JPEG or PNG poster, stored as-is.

```sh
curl -H "Authorization: Bearer $TOKEN" \
  -F 'meta={"title":"Demo","duration_ms":4200,"mime":"video/webm","storage":"local"}' \
  -F 'video=@demo.webm;type=video/webm' \
  -F 'thumb=@poster.jpg;type=image/jpeg' \
  http://127.0.0.1:8787/api/videos
```

### Public

| Method & path                              | Response |
|--------------------------------------------|----------|
| `GET /`                                    | `{"name": "tape-server", "ok": true}` |
| `GET /api/health`                          | `{"ok": true, "name": "tape-server", "version": "0.1.0"}` |
| `GET /v/:slug`                             | HTML share page (`web/viewer.html` with placeholders filled); unknown slug → `404` with `web/404.html` |
| `GET /api/public/videos/:slug`             | Video JSON |
| `GET /media/:slug`                         | The video. Local: file with `Range` → `206`, `Accept-Ranges`. Drive + API key: proxied from Google with the range forwarded. Otherwise `404`. |
| `GET /thumb/:slug`                         | Thumbnail image, `Cache-Control: public, max-age=3600`, or `404` |
| `POST /api/public/videos/:slug/view`       | `{"views": n}` after adding one view |
| `GET /api/public/videos/:slug/comments`    | `[{"id", "name", "body", "at_ms", "created_at"}]`, oldest first |
| `POST /api/public/videos/:slug/comments`   | Body `{"name", "body", "at_ms"?}` → `201` comment. Trimmed; empty name becomes `"Anonymous"`; name ≤ 60 and body 1–2000 characters, else `422`. |
| `GET /assets/*`                            | Static files from `web/assets/` |

### Share page template

`web/viewer.html` is a template. These placeholders are replaced with
HTML-escaped values on every request: `{{TITLE}}`, `{{SLUG}}`, `{{PAGE_URL}}`,
`{{MEDIA_URL}}`, `{{THUMB_URL}}`, `{{CREATED_ISO}}`, `{{DURATION_MS}}`,
`{{STORAGE}}`, `{{DRIVE_FILE_ID}}`, `{{EMBED_MODE}}`, `{{MIME}}` (null values
become empty strings). Values are escaped for HTML text and attributes, so put
them in markup (for example `data-*` attributes) and read them from script,
rather than writing them inside a `<script>` block. Static files for the page
go in `web/assets/` and are served under `/assets/`.

## Deploy

Run it behind a reverse proxy that terminates TLS (Caddy, nginx, Traefik) and
set `TAPE_PUBLIC_URL` to the public HTTPS origin, so share links and media
URLs point at it. Keep `TAPE_ADDR` on `127.0.0.1` when the proxy is on the
same host. Allow large request bodies on the proxy for uploads (nginx:
`client_max_body_size 8g;`) and don't buffer them (nginx:
`proxy_request_buffering off;`).

Example Caddyfile:

```
tape.example.com {
    reverse_proxy 127.0.0.1:8787
}
```

Back up `DATA_DIR` (the database, videos, thumbnails and token).

### Docker

```sh
docker build -t tape-server .
docker run -d --name tape -p 8787:8787 \
  -v tape-data:/app/data \
  -e TAPE_PUBLIC_URL=https://tape.example.com \
  tape-server
docker logs tape   # shows the owner token on first start
```

The image listens on `0.0.0.0:8787`, keeps data in the `/app/data` volume and
serves the bundled `web/` from `/app/web` (mount your own over it to change
the share page).
