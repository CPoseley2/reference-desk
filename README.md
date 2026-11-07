<p align="center"><a href="https://CPoseley2.github.io/reference-desk/"><img src="docs/assets/banner.svg" alt="Reference Desk — Give your story a world worth remembering" width="100%"></a></p>
<p align="center"><strong>A home for the visual decisions that make a production feel like one world.</strong></p>
<p align="center"><a href="https://CPoseley2.github.io/reference-desk/">Explore Reference Desk</a> · <a href="#start-your-first-production">Get started</a> · <a href="CONTRIBUTING.md">Contribute</a></p>
<p align="center">Local-first · macOS · Python standard library · MIT licensed</p>

Reference Desk is a local production reference workspace for filmmakers, animators, art departments, and independent storytellers. Bring characters, costumes, expressions, locations, and props into one organized desk. Compare possibilities, record decisions, and approve the exact image versions that define your world.

**This repository contains the reusable application and backend. It ships with no production libraries, reference images, saved decisions, or API credentials.** Your first launch creates an empty library on your own Mac.

## From inspiration to a consistent world

- **Build a visual cast.** Organize character likenesses, full-body references, hairstyles, wardrobe, and expressions.
- **Develop places and props.** Keep location coverage, studies, and supporting objects close to your production.
- **Make deliberate approvals.** Rankings and working selections remain separate from explicit approvals of exact image versions.
- **Keep projects independent.** Each library owns its catalog, images, decisions, revision history, and generation jobs.
- **Keep your work on disk.** Local JSON catalogs, image folders, review history, and exported snapshots remain accessible.
- **Generate when you choose.** Optional image generation uses your own OpenAI API account. Organizing and reviewing existing images requires no API key.

## Start your first production

**Requirements:** macOS and Python 3.9 or newer. Image processing uses macOS's built-in `sips`; the server also uses POSIX file locking. Windows is not supported, and full Linux support has not been validated. No pip or npm install is required for the app.

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

## Your files, your production

```text
reference-desk/
├── local_review_server.py   Local backend and review storage
├── library_server.py        Per-library HTTP routing
├── library_store.py         Empty-library creation and isolation
├── app.html, index.html…    Browser interface
├── library-templates/       Neutral starter resources
├── mac-app/                 Optional native macOS wrapper source
├── docs/                    Public splash page (static only)
├── libraries/               Created locally; ignored by Git
│   └── <library-id>/        Catalog, images, sources, decisions, jobs
└── .state/                  Local registry and optional API key; ignored
```

The service listens only on `127.0.0.1`. It is a personal local workspace, not a multi-user hosted service. GitHub Pages serves only the splash page; it does not run the backend or host your libraries.

**Back up your work:** stop Reference Desk and copy the complete working folder, including the hidden `.state/` directory and `libraries/`. A Git clone contains the software, not your library backup. Linked imports also require their original media folders to remain available.

## Optional image generation

Run `python3 -B setup_image_api.py` to store your own API key locally, or provide `OPENAI_API_KEY` in the server environment. Restart the service after changing its environment. Never commit credentials.

The current integration uses [GPT Image 2.5 Sunburst](https://developers.openai.com/api/docs/models/gpt-image-2.5-sunburst). Availability and charges depend on your API account. Explicit generation sends the submitted prompt and selected reference inputs to OpenAI; the rest of your library is not uploaded by this integration. Generated images remain candidates until you approve them.

Offline tests simulate generation. Live paid generation has not been verified for this release.

## Optional native Mac app

```sh
python3 mac-app/build.py
```

Requires macOS 13+ and Xcode command-line tools. This builds `Reference Desk.app` beside the checkout with a local ad-hoc signature. It is not a notarized installer. The app uses this framework folder, keeps libraries outside the bundle, and lets you choose a different framework folder if you move it. Quitting the window leaves the local service running; use the stop command to stop it.

## Development

```sh
python3 -B -m unittest -v test_framework test_libraries test_linked_library
python3 scripts/check_distribution.py
```

The integration tests use disposable copies and loopback servers, with no paid API calls. They cover empty starts, uploads, approvals, save conflicts, migration, library isolation, and linked-media behavior. CI runs on macOS. See [architecture and API notes](DEVELOPMENT.md) and [contribution guidance](CONTRIBUTING.md).

The landing page needs no build tools: `python3 -m http.server 8099 --directory docs`. Open http://localhost:8099/.

## License

[MIT](LICENSE). Use and adapt the framework for personal or commercial productions. Content you add to your libraries retains its own ownership and licensing; the software license does not grant rights to third-party reference material.
