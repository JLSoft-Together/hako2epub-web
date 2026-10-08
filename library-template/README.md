# hako2epub library template

Template for the personal "library" repository used by hako2epub-web. The web UI
(GitHub Pages) dispatches the workflows in this repo; the workflows check out the
public `hako2epub-web` repo and run `python -m hako_worker <cmd>`.

**The library repo MUST stay private.** It stores translated novels and is meant
for personal, non-commercial use only.

## Setup

1. Create a new **private** repository (e.g. `hako2epub-library`).
2. Copy the contents of this `library-template/` folder into the root of that repo
   (`.github/workflows/*.yml` and `data/ln_info.json`), commit and push to `main`.
3. In all three workflows (`inspect.yml`, `download.yml`, `update.yml`) replace the
   placeholders in the checkout step:
   - `<OWNER>` with the GitHub user that owns the public app repo (the checkout
     `repository:` then reads `<OWNER>/hako2epub-web`, e.g. `PNThanggg/hako2epub-web`).
   - `<TAG>` with a release tag of that repo, e.g. `v0.1.0`.
4. Create a fine-grained Personal Access Token for the web UI:
   - Repository access: **only this library repo**.
   - Permissions: **Contents** Read & write, **Actions** Read & write,
     **Metadata** Read.
5. Paste the PAT and the library repo name into the web UI settings.

## Storage layout

- `main`: `data/ln_info.json` and `data/novels/*.json` (library index and novel metadata).
- `files` branch: the generated EPUB files (not stored in Releases).
- `status/<request_id>` branches: per-request `progress.json`, written by the worker.

## Workflows

| File | Command | Purpose |
| --- | --- | --- |
| `inspect.yml` | `inspect` | Fetch novel info and volumes |
| `download.yml` | `download` | Download selected volumes/chapters into EPUBs |
| `update.yml` | `update` | Check for and download new chapters |

Each takes inputs `request_id` and `payload` (JSON). Example:

```bash
gh workflow run inspect.yml -R <o>/hako2epub-library -f request_id=$(uuidgen) -f payload='{"url":"<url>"}'
```
