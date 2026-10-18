# /// script
# requires-python = ">=3.10,<3.15"
# dependencies = ["moondream>=2.4"]
# ///
"""Local speech-to-text for Tape: Parakeet Redux behind an OpenAI-style endpoint.

    uv run transcribe/tape_transcribe.py            # http://127.0.0.1:8790

Tape (Settings -> Transcription) posts each recording's audio to
POST /v1/audio/transcriptions and gets timed segments back. Any other server with the
same endpoint (whisper.cpp, Speaches, LocalAI) works with Tape too; this one runs
moondream/parakeet-redux (178 MB, 25 languages, word timestamps) on this computer.
Nothing leaves the machine: it listens on 127.0.0.1 only unless you pass --host.
"""

import argparse
import email.parser
import email.policy
import json
import os
import sys
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

MODEL = "moondream/parakeet-redux"


def parse_multipart(content_type: str, body: bytes) -> dict:
    """Form fields of a multipart/form-data body: name -> (filename or None, bytes)."""
    msg = email.parser.BytesParser(policy=email.policy.HTTP).parsebytes(
        b"Content-Type: " + content_type.encode() + b"\r\n\r\n" + body
    )
    fields = {}
    for part in msg.iter_parts():
        name = part.get_param("name", header="content-disposition")
        if name:
            fields.setdefault(name, (part.get_filename(), part.get_payload(decode=True) or b""))
    return fields


def openai_reply(result: dict, duration: float | None) -> dict:
    """Photon's result to OpenAI verbose_json: text, segments (with words), flat words."""
    segments, words = [], []
    for i, s in enumerate(result.get("segments") or []):
        seg_words = [{"word": w["word"], "start": w["start"], "end": w["end"]} for w in s.get("words") or []]
        segments.append({"id": i, "start": s["start"], "end": s["end"], "text": s["text"], "words": seg_words})
        words.extend(seg_words)
    return {
        "task": "transcribe",
        "language": result.get("language"),
        "duration": duration,
        "text": result.get("text", ""),
        "segments": segments,
        "words": words,
        "model": "parakeet-redux",
    }


class Handler(BaseHTTPRequestHandler):
    server_version = "tape-transcribe/1.0"
    speech = None
    lock = threading.Lock()  # one transcription at a time; the model is not re-entrant

    def _json(self, status: int, payload: dict) -> None:
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def _error(self, status: int, message: str) -> None:
        self._json(status, {"error": {"message": message}})

    def do_OPTIONS(self) -> None:
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.end_headers()

    def do_GET(self) -> None:
        if self.path.rstrip("/") in ("/v1/models", "/models"):
            return self._json(200, {"object": "list", "data": [{"id": "parakeet-redux", "object": "model", "owned_by": "moondream"}]})
        if self.path.rstrip("/") in ("", "/health"):
            return self._json(200, {"ok": True, "model": MODEL})
        self._error(404, "Not found.")

    def do_POST(self) -> None:
        if self.path.rstrip("/") not in ("/v1/audio/transcriptions", "/audio/transcriptions"):
            return self._error(404, "Not found.")
        length = int(self.headers.get("Content-Length") or 0)
        if not length:
            return self._error(400, "Send the audio as multipart form field 'file'.")
        fields = parse_multipart(self.headers.get("Content-Type", ""), self.rfile.read(length))
        if "file" not in fields:
            return self._error(400, "Send the audio as multipart form field 'file'.")
        filename, audio = fields["file"]
        granular = [v.decode() for k, (_, v) in fields.items() if k.startswith("timestamp_granularities")]
        detail = "word" if "word" in granular or not granular else "segment"

        suffix = os.path.splitext(filename or "")[1] or ".wav"
        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as f:
            f.write(audio)
            path = f.name
        try:
            started = time.time()
            with self.lock:
                result = Handler.speech.transcribe(audio=path, timestamps=detail)
            took = time.time() - started
            segs = result.get("segments") or []
            duration = segs[-1]["end"] if segs else None
            reply = openai_reply(result, duration)
            if duration:
                print(f"transcribed {duration:.1f}s of audio in {took:.2f}s ({duration / max(took, 1e-6):.0f}x real time)", flush=True)
            self._json(200, reply)
        except Exception as e:  # noqa: BLE001 - report any model failure to the caller
            self._error(500, f"Transcription failed: {e}")
        finally:
            os.unlink(path)

    def log_message(self, fmt: str, *args) -> None:  # quieter than the default access log
        pass


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=8790)
    ap.add_argument("--device", choices=["cpu", "mps", "cuda"], help="default: CUDA, then Apple silicon, then CPU")
    args = ap.parse_args()

    import moondream as md

    print(f"Loading {MODEL} (downloads 178 MB the first time)...", flush=True)
    kwargs = {"device": args.device} if args.device else {}
    with md.photon(MODEL, **kwargs) as speech:
        Handler.speech = speech
        server = ThreadingHTTPServer((args.host, args.port), Handler)
        print(f"tape-transcribe listening on http://{args.host}:{args.port}  (Tape: Settings -> Transcription)", flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            print("\nStopped.", file=sys.stderr)


if __name__ == "__main__":
    main()
