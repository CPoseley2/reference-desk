# Architecture and integration notes

The application is a local Python HTTP service with a plain HTML/CSS/JavaScript interface. It requires macOS for its complete image-processing workflow.

`library_server.py` routes `/libraries/<id>/…` requests to a fixed context. `library_store.py` owns the registry, creates empty catalogs, and ties each context to its own review store and job manager. `local_review_server.py` handles versioned decisions, atomic persistence, same-origin writes, and review merges. Catalog modules handle characters, looks, expressions, props, and locations. `image_generation.py` runs explicitly submitted jobs; `canon_manifest.py` derives approved references from saved decisions.

## API entry points

| Route | Purpose |
| --- | --- |
| `GET /api/health` | Local service identity |
| `GET /api/libraries` | Library directory and application CSRF token |
| `POST /api/libraries` | Create an empty library using `name` and UUID `request_id` |
| `GET /libraries/<id>/api/review` | Saved decisions, revision, library CSRF token |
| `POST /libraries/<id>/api/review` | Save validated decisions with base revision and mutation ID |
| `POST /libraries/<id>/api/merge` | Resolve concurrent review changes |
| `GET /libraries/<id>/api/director-references` | Derived approved references |
| `GET /libraries/<id>/api/history` | Available review revisions |
| `POST /libraries/<id>/api/characters` | Add a character |
| `POST /libraries/<id>/api/locations` | Add a location |
| `POST /libraries/<id>/api/props` | Add a prop |
| `GET /libraries/<id>/api/generation/config` | Generation configuration and activity |
| `POST /libraries/<id>/api/generation/jobs` | Explicitly submit a generation job |

Writes require JSON, the exact loopback `Origin`, and `X-DESK-CSRF` from the appropriate application or library response. Review mutations use revision checks. These are internal APIs, not a stable versioned public API; consult handlers and tests for payloads before integrating. Do not expose this server publicly or treat its local tokens as multi-user authentication.

## Linked-library imports

`import_linked_library.py` supports compatible legacy catalog/review schemas. Preparation stages an independent writable catalog and a checksum-checked read-only media map, then registration makes it visible. No existing production is bundled or imported automatically. Original media paths must remain available. Compatibility namespace strings in the importer and synthetic tests are format identifiers, not embedded production data.

## Public website

`docs/` is a standalone static site. GitHub Pages publishes this directory only. Its illustrations and demonstration labels were created for this repository and are not production screenshots. The interactive category switcher is a marketing illustration, not a hosted copy of Reference Desk.
