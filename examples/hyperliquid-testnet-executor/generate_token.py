#!/usr/bin/env python3
"""Print a strong shared password for the ClearSig testnet executor."""

from __future__ import annotations

import secrets


if __name__ == "__main__":
    print(secrets.token_hex(32))
