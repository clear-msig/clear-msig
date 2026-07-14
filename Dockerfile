# syntax=docker/dockerfile:1.6
#
# Builds the clear-msig backend API as a provider-neutral container image.
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

RUN cargo build --release -p clear-msig-backend-api \
    && cp target/release/clear-msig-backend-api /clear-msig-backend-api

# ----------------------------------------------------------------------

FROM debian:bookworm-slim AS runtime

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    libssl3 \
    libudev1 \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /clear-msig-backend-api /usr/local/bin/clear-msig-backend-api
COPY ops/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

# Intent JSON templates loaded by the shared execution library.
COPY examples /app/examples

WORKDIR /app

ENV CLEAR_MSIG_ENV=production
ENV RUST_LOG=info
EXPOSE 8080

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
