# syntax=docker/dockerfile:1

# --- build -------------------------------------------------------------------
FROM rust:1-slim AS build
WORKDIR /src

# cmake + clang build aws-lc (rustls' crypto) on targets without prebuilt bits.
RUN apt-get update \
 && apt-get install -y --no-install-recommends cmake clang \
 && rm -rf /var/lib/apt/lists/*

# Build dependencies first so they are cached across source changes.
COPY Cargo.toml Cargo.lock ./
RUN mkdir src && echo 'fn main() {}' > src/main.rs && touch src/lib.rs \
 && cargo build --release --locked \
 && rm -rf src target/release/deps/tape_server* target/release/deps/libtape_server* target/release/.fingerprint/tape-server-* target/release/tape-server*

COPY src ./src
RUN cargo build --release --locked

# --- runtime -----------------------------------------------------------------
# (Debian already has a "tape" group for tape drives, so the user is tapesrv.)
FROM debian:stable-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && useradd --system --home /app --uid 10001 --user-group tapesrv \
 && mkdir -p /app/data \
 && chown tapesrv:tapesrv /app/data

WORKDIR /app
COPY --from=build /src/target/release/tape-server /usr/local/bin/tape-server
COPY web ./web

ENV TAPE_ADDR=0.0.0.0:8787 \
    TAPE_DATA_DIR=/app/data \
    TAPE_WEB_DIR=/app/web
VOLUME ["/app/data"]
EXPOSE 8787
USER tapesrv
CMD ["tape-server"]
