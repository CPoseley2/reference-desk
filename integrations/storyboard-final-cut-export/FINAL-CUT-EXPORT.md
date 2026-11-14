# Export Final Cut XML

Added November 14, 2026. Use **Export Final Cut XML** on a Command Center film card, an individual version row, or the storyboard viewer header.

1. Check the displayed version and choose the exact recording and frame rate.
2. Click **Check saved storyboard**. Pending edits in the current viewer are saved through its existing save bridge. Resolve any save conflict first. Other open tabs must finish saving before their changes can be included.
3. Click **Create XML package**. The saved snapshot is checked again; changes since preflight require another check.
4. Download the XML or complete media ZIP. The dialog shows the actual local package folder and recent exports.
5. Double-click the XML in Finder, import into a new Final Cut library, and inspect picture and sound.
6. In Final Cut, choose **Share → Export File → Settings → Computer → H.264 → 1920 × 1080 → Save only**. Confirm the full duration and `.mp4` extension. Final Cut may remember a lower resolution.

Output is a 1080p still-image timeline with a continuous recording. Selected image swaps and normalized crops are preserved. Smaller images scale up proportionally. There is no new imagery, animation, lip-sync, or movie rendering in this action, and it does not alter source media, reviews, or the film-export registry.

## Files and status

Each successful package lives in `exports/final-cut/<export-id>/` and contains `Storyboard.fcpxml`, `Media/`, `export-manifest.json`, `checksums.json`, `README.txt`, and `Final-Cut-Package.zip`. `feedback/final-cut-exports/` stores job/history records. Ready is reported only after media copying, XML validation, and ZIP creation complete. Failed or interrupted work is not marked ready.

XML contains absolute file URIs pointing to the local package. If moved to another folder or computer, relink the `Media` folder in Final Cut. Keep it in place until Final Cut has copied media into its own library.

An XML package is not an HD movie. Rendered-movie registration and automatic Final Cut app control remain separate workflows.

## Supported inputs

Timed still-image storyboards; one indexed audio-only recording; mono or stereo; 24, 25, 30, 24000/1001 or 30000/1001 fps; normalized rectangular image crops. Saved beat timing is used when configured for the selected version; otherwise source slot timing is used. Missing slots, non-continuous timing, stale source snapshots, changed known asset hashes, and mismatched picture/audio duration block export with a specific message. A final still can extend by a fraction of a frame to preserve the full audio tail.

Requires local Python, ffprobe, ffmpeg for cropped panels, xmllint, and the installed Final Cut FCPXML 1.10 DTD. No third-party generation API is called. Offline file browsing cannot create export packages.

## Implementation and checks

`final_cut_export.py` handles snapshot normalization, media preparation, rational frame arithmetic, XML generation, validation and background package creation. `final-cut-export.js` and `.css` provide the shared panel. `server.py` adds same-origin, CSRF-protected preflight/create routes and read-only options/status routes.

Run `python3 -B -m unittest test_final_cut_export.py -v` from this folder. Tests cover saved replacements, crop output, continuous audio, embedded media, saved timing revisions, source changes, unregistered paths, gaps, missing selections, fractional frame tails, XML schema validation, and idempotent requests.
