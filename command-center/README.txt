STORYBOARD COMMAND CENTER
Reference Desk · MIT licensed · macOS / Python 3.11+

The portable edition includes the dashboard, image arrangement and review tools,
shot direction workspace, canvas, flags, timing integration, and Final Cut export.
It starts empty. Production-specific script parsers and inventories from the
original production workspace are not included.

START
From the Reference Desk repository folder:

  python3 command-center/setup.py
  python3 command-center/catalog.py add /absolute/path/to/storyboard.json
  python3 command-center/launch.py

The setup script connects this bundled module to Reference Desk's Storyboards
page. It refuses to replace an existing private connection. The standalone
launcher opens http://127.0.0.1:8899/ and refuses to take over another workspace.
Use Python 3.11+ explicitly; Apple's older system Python may not be sufficient.

REGISTER YOUR SOURCES
Create a JSON file in your own production folder. For example:

{
  "title": "Opening sequence",
  "production": "My film",
  "shots": [
    {"id": "S001", "title": "Establish the world", "image": "images/lake.png",
     "prompt": "Wide shot. Hold steady as the light fades.", "start": 0, "end": 4},
    {"id": "S002", "title": "A figure arrives", "image": "images/figure.png",
     "prompt": "Medium shot. Keep the horizon consistent.", "start": 4, "end": 8}
  ],
  "audio": ["recording.wav"],
  "locations": ["images/lake.png"],
  "characters": [{"id": "keeper", "name": "The keeper", "images": ["images/figure.png"]}]
}

Only shots is required; an empty array creates an empty board. Image and audio
paths are relative to the source JSON, or absolute local paths. Missing images
remain pending. Network URLs and hidden paths are rejected. Shot IDs must be
unique. Optional start/end times are seconds, with end after start.

Optional script points to a local .txt, .md, or .fountain file. Each shot can
include script_start and script_end (inclusive, one-based line numbers).
Without a script, shot titles seed a neutral script context. Characters and
locations seed the shot workspace once; they are explicit references, not an
automatic scan of your library.

  python3 command-center/catalog.py add /path/board.json --production "My film" --act 2

Repeat for different source files. The private sources.json registry can group
versions by production. Set primary: true on the desired version (and false on
others) to select it. Refresh rereads source snapshots; existing editable
catalogs, direction controls, assignments and feedback are preserved. To start
a substantially changed board as a new version, register a new source filename.
Saved editing data is intentionally separate from original sources.

REFERENCE DESK IMAGERY
Optionally create command-center/desk-connection.json:

  {"library_id": "YOUR_32_CHARACTER_LIBRARY_ID", "match_tags": []}

Use the ID in your local Reference Desk library URL. The default framework root
is this module's parent. You can set framework_root to another installation.
Restart Command Center after changing the connection. Its Reference Desk image
browser reads only that chosen library. No credentials are needed for browsing.

CRESCENDO AND TIMING
Install audio dependencies from Reference Desk with Set Up Crescendo.command,
or follow the root README. Analyze a recording in Crescendo. Its optional read-only storyboard bridge
uses a private crescendo-analysis.json registry; production-specific analysis
registrations are not bundled or inferred. Developers can adapt that registry
using crescendo_bridge.py and test_crescendo.py as the schema reference.
Cut suggestions are review material. Beat editing requires a matching private beat-edits/<entry-id>.json
configuration containing fps, shot_ids, initial_end_frames and audio_sha256;
beat_timing.py documents validation. This portable registration does not infer
beat boundaries from an arbitrary source. Ordinary timed playback works from
source start/end fields, and Final Cut export also supports fixed clip durations.

FINAL CUT XML
Requires ffmpeg and ffprobe on PATH, macOS xmllint, and Final Cut Pro installed
with its FCPXML 1.10 DTD. Use the export control, select timing/audio settings,
review preflight, and create a package. It contains FCPXML, selected still media,
optional audio, and a manifest. Source changes, missing selections and invalid
timing block packaging. Import the XML into Final Cut for editing; no finished
movie is rendered and no video-generation or publishing service is called.

PRIVATE WORKING DATA AND BACKUPS
sources.json, allowlist.json, connection settings, inventories, view-data,
image-libraries, image-imports, shot-workspace-data, feedback, beat-edits,
beat-analysis, crescendo-records, production-briefs and exports are local runtime
data ignored by Git. Stop services and back up the entire working folder plus
all original registered sources/media. A Git push is not a production backup.
The service listens on loopback only and is for a single user's local workspace.

DEVELOPMENT
  python3 -B -m unittest discover -s command-center -p 'test_*.py'
  node --test command-center/tests/*.test.js

Export tests skip when required tools or the Final Cut schema are unavailable.
No production media, inventory, credentials or saved decisions ship in this repo.

OPTIONAL YOUTUBE PUBLICATION CHECK
This is disabled until you explicitly configure youtube-channel.json. Install
requirements-youtube.txt into command-center/.venv-youtube. Configuration needs
name, a verified channel_id, a URL of the form
https://www.youtube.com/@Example/videos, and optional aliases mapping film IDs
to title lists. If a musical/collection shares a song title, collection_title
helps distinguish that title from subtitles. Checks read the configured public
channel through yt-dlp; they never upload or publish videos.
