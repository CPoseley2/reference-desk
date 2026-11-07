# Contributing to Reference Desk

Small, focused improvements are welcome. Open an issue describing the production problem, or submit a pull request with the behavior change and the checks you ran.

Use a fresh checkout and disposable libraries for development. Never include real production catalogs, images, scripts, prompts, credentials, or local filesystem paths in issues, screenshots, commits, or test fixtures. Use invented examples and self-created assets.

Run the three integration-test modules and `python3 scripts/check_distribution.py` before submitting. Keep the Python standard-library setup and plain browser JavaScript approachable. Tests that launch the server should bind to loopback on an ephemeral port.

Preserve these boundaries: each library owns its state; generation and selection do not imply approval; approvals identify exact image versions; linked source files stay read-only; public distribution contains only software and neutral resources.

By contributing, you agree that your contribution is distributed under the repository's MIT license.
