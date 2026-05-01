# syntax=docker/dockerfile:1.6
#
# Builds the clear-msig backend-api + CLI as a single container image for Fly.io.
# Multi-stage: cache-friendly builder layer, slim runtime layer.

FROM rust:1.95-bookworm AS builder

RUN apt-get update && apt-get install -y --no-install-recommends \
    protobuf-compiler \
    libssl-dev \
    libudev-dev \
    pkg-config \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /build

# Copy the workspace. Granular COPY -> Cargo build caching is fragile in this
# multi-crate workspace because of the [patch.crates-io] entry pointing at
# deps/solana-curve25519, so we just copy the lot once and rely on the actions
# build cache (or local Docker layer cache) for re-builds.
COPY . .

RUN cargo build --release -p clear-msig-cli -p clear-msig-backend-api

# ----------------------------------------------------------------------

FROM debian:bookworm-slim AS runtime

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    libssl3 \
    libudev1 \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /build/target/release/clear-msig          /usr/local/bin/clear-msig
COPY --from=builder /build/target/release/clear-msig-backend-api /usr/local/bin/clear-msig-backend-api
COPY ops/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

# Intent JSON templates the CLI loads at prepare-time. The backend
# forwards a relative path like `examples/intents/solana_transfer.json`
# from the frontend straight into the spawned CLI, so the CLI's CWD
# has to contain that tree. WORKDIR below pins it.
COPY examples /app/examples

WORKDIR /app

ENV CLEAR_MSIG_BIN=/usr/local/bin/clear-msig
ENV BACKEND_API_BIND=0.0.0.0:8080
ENV RUST_LOG=info
EXPOSE 8080

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
