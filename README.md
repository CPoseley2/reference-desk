# Reference Desk

**A local workspace for organizing visual references and approving the creative decisions behind a production.**

Reference Desk helps filmmakers, animators, art departments, and independent storytellers bring characters, costumes, expressions, locations, and props into one organized workspace. Compare alternatives, record decisions, and approve the exact image versions that define your production.

[Project overview](https://cposeley2.github.io/reference-desk/) · [Command Center feature page](https://cposeley2.github.io/reference-desk/command-center/) · [Getting started](#start-your-first-production) · [Development guide](DEVELOPMENT.md) · [Contributing](CONTRIBUTING.md)

![Reference Desk — Give your story a world worth remembering](docs/assets/banner.svg)

## At a glance

| Area | Details |
| --- | --- |
| Platform | macOS; Python 3.11 or later |
| Application | Python standard-library backend with an HTML, CSS, and JavaScript interface |
| Storage | Local project libraries, JSON catalogs, images, and revision history |
| Optional tools | Image generation through your own OpenAI API account; Crescendo audio analysis; Storyboard Command Center; native macOS wrapper |
| License | MIT |

The repository contains the reusable application and backend. Your first launch creates an empty library on your Mac; production libraries, reference images, saved decisions, and API credentials are not bundled.

## Features

- **Build a visual cast.** Organize character likenesses, full-body references, hairstyles, wardrobe, and expressions.
- **Develop places and props.** Keep location coverage, studies, and supporting objects close to your production.
- **Make deliberate approvals.** Rankings and working selections remain separate from explicit approvals of exact image versions.
- **Keep projects independent.** Each library owns its catalog, images, decisions, revision history, and generation jobs.
- **Keep your work on disk.** Local JSON catalogs, image folders, review history, and exported snapshots remain accessible.
- **Recognize and manage each production.** Library covers, outreach contact/inquiry tools, save recovery, and API diagnostics support daily work.
- **Generate when you choose.** Optional image generation uses your own OpenAI API account. Organizing and reviewing existing images requires no API key.

## Storyboard Command Center

[Explore the feature page](https://cposeley2.github.io/reference-desk/command-center/).

The bundled Command Center brings storyboard coverage and versions, image arrangements,
shot direction, script context, flags, revision-aware saves, a floating/full-screen
canvas, configured beat timing, and Final Cut XML packaging into the production workflow.
The portable edition starts empty and registers your own JSON storyboards explicitly.
Production-specific inventory builders are replaced by this documented registration path.

```sh
python3 command-center/setup.py
python3 command-center/catalog.py add /absolute/path/to/storyboard.json
python3 command-center/launch.py
```

Open **Storyboards** inside Reference Desk, or use the standalone local workspace on
port 8899. See the [source format, optional connections, and export requirements](command-center/README.txt).
Final Cut export packages an editable still-image timeline; it does not render a movie.

## Start your first production

**Requirements:** macOS and Python 3.11 or newer. Image processing uses macOS's built-in `sips`; the server also uses POSIX file locking. Windows is not supported, and full Linux support has not been validated. No pip or npm install is required for the core app. Optional Crescendo analysis has additional dependencies; Final Cut export needs external tools (below).

```sh
git clone https://github.com/CPoseley2/reference-desk.git
cd reference-desk
python3 -B launch_review.py
```

Your browser opens at **http://127.0.0.1:8876/**. Open the empty **My Library**, or create a library for your production. Add a character or location, upload references, then start reviewing.

You can also [download the source ZIP](https://github.com/CPoseley2/reference-desk/archive/refs/heads/main.zip), extract it, and run the command from the extracted folder. The included **Start Reference Desk.command** and **Stop Reference Desk.command** launchers use `/usr/bin/python3` on macOS.

To stop the background service:

```sh
python3 -B launch_review.py --stop
```

If port 8876 is already used by another Reference Desk installation, stop that installation first. The launcher refuses to take over another service. A development instance can run in the foreground on a different port with `python3 -B local_review_server.py --port 8877 --open`.

## Project structure & data

```text
reference-desk/
├── local_review_server.py   Local backend and review storage
├── library_server.py        Per-library HTTP routing
├── library_store.py         Empty-library creation and isolation
├── app.html, index.html…    Browser interface
├── library-templates/       Neutral starter resources
├── mac-app/                 Optional native macOS wrapper source
├── command-center/          Portable storyboard workspace; runtime data ignored
├── crescendo-engine/        Optional local recording analysis engine
├── docs/                    Splash and Command Center feature pages (static only)
├── libraries/               Created locally; ignored by Git
│   └── <library-id>/        Catalog, images, sources, decisions, jobs
└── .state/                  Local registry and optional API key; ignored
```

The service listens only on `127.0.0.1`. It is a personal local workspace, not a multi-user hosted service. GitHub Pages serves only the splash page; it does not run the backend or host your libraries.

**Back up your work:** stop Reference Desk and copy the complete working folder, including the hidden `.state/` directory and `libraries/`. A Git clone contains the software, not your library backup. Linked imports and Command Center registrations also require their original sources and media folders. Back up Command Center runtime directories as described in its setup guide.

## Optional image generation

Run `python3 -B setup_image_api.py` to store your own API key locally, or provide `OPENAI_API_KEY` in the server environment. Restart the service after changing its environment. Never commit credentials.

The image-generation integration uses your own OpenAI API account. Model availability and charges depend on that account. Explicit generation sends the submitted prompt and selected reference inputs to OpenAI; the rest of your library is not uploaded by this integration. Generated images remain candidates until you approve them.

Offline tests simulate generation. Live paid generation has not been verified for this release.

## Optional Crescendo audio analysis

Analyze a recording locally, inspect musical events, and review suggested cuts. Install
its dependencies with **Set Up Crescendo.command**, or:

```sh
python3 -m venv .venv-crescendo
.venv-crescendo/bin/python -m pip install -r crescendo-engine/scripts/requirements.txt
mkdir -p .state
printf '%s/.venv-crescendo/bin/python\n' "$PWD" > .state/crescendo-python
```

Analysis outputs live in each library's private `.state/crescendo` directory. The
interface is available without installing the analyzer; processing a recording needs
the environment above. No recording is sent to a cloud analysis service.

## Optional native Mac app

```sh
python3 mac-app/build.py
```

Requires macOS 13+ and Xcode command-line tools. This builds `Reference Desk.app` beside the checkout with a local ad-hoc signature. It is not a notarized installer. The app uses this framework folder, keeps libraries outside the bundle, and lets you choose a different framework folder if you move it. Quitting the window leaves the local service running; use the stop command to stop it.

## Development

```sh
python3 -B -m unittest -v test_framework test_libraries test_linked_library test_storyboard test_outreach test_library_covers test_api_diagnostics test_revision_context
python3 -B -m unittest discover -s command-center -p 'test_*.py'
node --test tests/*.test.js command-center/tests/*.test.js
python3 scripts/check_distribution.py
```

The integration tests use disposable copies and loopback servers, with no paid API calls. They cover empty starts, uploads, approvals, save conflicts, migration, library isolation, and linked-media behavior. CI runs on macOS. Crescendo tests run with its optional dependencies. Export packaging tests require the Final Cut Pro schema and skip when it is unavailable. See [architecture and API notes](DEVELOPMENT.md) and [contribution guidance](CONTRIBUTING.md).

The landing page needs no build tools: `python3 -m http.server 8099 --directory docs`. Open http://localhost:8099/.

## Author

Created by [Collin “Keek” Poseley](https://github.com/CPoseley2).

## License

[MIT](LICENSE). Use and adapt the framework for personal or commercial productions. Content you add to your libraries retains its own ownership and licensing; the software license does not grant rights to third-party reference material.
