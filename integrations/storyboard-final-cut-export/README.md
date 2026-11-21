# Storyboard → Final Cut XML

Export the saved image choices, crops, cut timing, and selected recording from a Storyboard Command Center version into an editable 1080p Final Cut timeline. The local service copies the media and validates the XML before reporting a package ready. Final Cut performs the movie render; this action makes no image-generation or video-generation API requests.

This directory preserves the working exporter and its integration points for the **separate Storyboard Command Center**. It is not a standalone application, and cloning Reference Desk does not automatically install or enable it. Reference Desk's `library_server.py` is a different host from the Command Center's `server.py`.

## Contents

- `final_cut_export.py`: snapshot validation, frame arithmetic, media copying/cropping, FCPXML generation, schema validation, and background export jobs.
- `final-cut-export.js` / `.css`: shared recording/frame-rate dialog, preflight, progress, downloads, history, and a plain-text viewer button.
- `command-center.patch`: the original changes to the Command Center server and film/version card renderer.
- `test_final_cut_export.py`: invented two-shot fixtures, generated PNGs and silent WAV audio; no production assets.
- [User guide](FINAL-CUT-EXPORT.md): day-to-day export and Final Cut rendering steps.

## Integrate with an existing Command Center

1. Back up the Command Center code. Work in a copy before updating a running installation. Its `server.py`, `catalog-ui.js`, `index.html`, `viewer.html`, saved-editor bridge, and data contracts below must already exist.
2. Copy `final_cut_export.py`, `final-cut-export.js`, `final-cut-export.css`, and `FINAL-CUT-EXPORT.md` into that app's root.
3. From the app root, check the patch with `git apply --check /path/to/command-center.patch`, then apply it with `git apply /path/to/command-center.patch`. Git can check/apply this patch outside a repository. If the check fails, merge the small server routes and `data-fcpxml-id` button additions manually. Do not overwrite a newer renderer or apply the patch a second time.
4. Add this stylesheet to both `index.html` and `viewer.html`:

   ```html
   <link rel="stylesheet" href="final-cut-export.css?v=1">
   ```

5. Add this script near the end of both pages, after the existing editor/save bridge:

   ```html
   <script src="final-cut-export.js?v=1"></script>
   ```

6. Restart the local Command Center service and reload the page. Open a known version, choose **Export Final Cut XML**, check the saved edit, and create a package. Verify the XML in Final Cut before delivering a rendered movie.

The patch is a baseline integration, not a deployment script. Later local layout changes are outside this package. Other layouts can use any button with `data-fcpxml-id="<entry-id>"`; retain the accessible label and version-specific ID.

## Host and data contracts

The host must retain its loopback-only server, Host/Origin checks, CSRF validation, JSON body checks, media path allowlist, and save lock. The patch inserts write routes **after** the existing protections. It expects `ROOT`, `LOCK`, `TOKEN`, `atomic(path, data)`, `approved(path)`, and `resolve_media_path(ref)` from the host. Never expose these endpoints as an unauthenticated internet service.

The browser uses the existing `ReferenceDeskBridge.flush()` to finish pending saves in the current viewer. Other tabs must finish their own saves before export. The server resolves current saved data again at creation time and rejects a stale preflight fingerprint.

| Local input | Required contents |
| --- | --- |
| `inventory.json` | `entries` with 16-hex `id`, title, song, source path, optional review note and source signatures |
| `view-data/<id>.js` | `window.VIEW=` JSON snapshot with source SHA and indexed audio references |
| `image-libraries/<id>.json` | Matching source SHA, ordered timed slots, assets with IDs/paths/hashes/normalized crops |
| `feedback/arrangements/<id>.json` | Saved revision, slot-to-asset assignments, optional related assets |
| `beat-edits/<id>.json` | Optional version-specific rate, ordered shot IDs, initial end frames and recording identity |
| `feedback/timings/<id>.json` | Optional saved timing revision and edited end frames |

Tests demonstrate the minimal input shape. Empty selections, missing media, changed sources, timing gaps, mismatched audio, unsupported media, and zero-frame cuts produce blockers instead of substitutions. Supported rates are 24, 25, 30, 24000/1001 and 30000/1001 fps. The full soundtrack is retained; a fractional-frame tail extends the last still to the next frame boundary.

Completed packages go under `exports/final-cut/<export-id>/`; job records go under `feedback/final-cut-exports/`. Keep these runtime directories, source catalogs, recordings, artwork, manifests, and credentials out of Git. Download links require the host's existing `/exports/` static serving behavior. XML uses absolute local media URIs; moving a package requires relinking in Final Cut.

## Dependencies and checks

Python 3.10+ standard library, `ffprobe`, `ffmpeg` for crops, `/usr/bin/xmllint`, and Final Cut Pro's installed FCPXML 1.10 DTD are required for full exports. Apple's schema is not redistributed. The current validator expects Final Cut Pro in the standard Applications location. This is a macOS integration.

From the repository root:

```sh
python3 -B -m unittest discover -s integrations/storyboard-final-cut-export -p 'test_final_cut_export.py' -v
node --check integrations/storyboard-final-cut-export/final-cut-export.js
```

Nine tests cover saved replacements/crops, recording identity, embedded audio, saved timing, stale requests, gaps, unauthorized media paths, changed sources, frame tails, and package/XML structure. All nine passed on the development Mac with Final Cut installed. CI installs FFmpeg and runs the same suite; the full-package schema test explicitly skips if Apple's DTD is absent. That skip does not count as Final Cut validation. Actual package creation always requires the DTD and fails if it is missing.

The installed UI was exercised through preflight, package creation, history, and download links. A production-sized local test produced 87 still clips and one continuous 262.96-second recording at 25 fps, with 88 checked media files and a valid ZIP. Production media and identifying paths are excluded from this distribution. The button-generated XML passed the installed schema; a separate Final Cut import and relocated-package relink test remain unperformed.

Automatic app launch, movie rendering, rendered-movie registration, motion effects, video clips, transitions, and lip sync are not part of this first release. XML readiness does not change creative approval or mark a film as a rendered HD movie.
