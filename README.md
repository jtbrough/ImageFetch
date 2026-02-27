# ImageFetch

<p align="center">
  <img src="https://github.com/user-attachments/assets/f2f30dc4-93e9-455a-8097-56721fb0aa4c" alt="ImageFetch screenshot" width="70%" />
</p>

ImageFetch is a single-page web app that fetches and previews site image assets:

- Favicons
- Apple touch icons
- Header images (including a first-image fallback)

It preserves source bytes for download/copy when available and presents grouped results with variant navigation.

## Background

The app is intentionally dependency-light:

- Frontend: plain HTML/CSS/JS in one file (`index.html`)
- Backend: Node built-ins only (`server.js`)

## Features

- URL input with local history (last 15 sites)
- Auto-https for bare domains (example: `example.com`)
- Grouped browsing for favicon / apple-touch / header image variants
- Copy image to clipboard (with PNG fallback)
- Download original file
- Metadata per asset (dimensions, type, size, MIME, aspect ratio, source)
- Options for max images, timeout, and header scan depth

## Usage

### Local (Node)

```bash
cd ImageFetch
node server.js
```

Open: [http://127.0.0.1:8788](http://127.0.0.1:8788)

## Docker Deployment

### With `just` (recommended)

```bash
cd ImageFetch
just docker-build
just docker-run
```

### With Docker CLI

```bash
cd ImageFetch
docker pull ghcr.io/jtbrough/imagefetch:latest
docker run --rm --name ImageFetch -p 8788:8788 ghcr.io/jtbrough/imagefetch:latest
```

### With Compose

```bash
cd ImageFetch
docker compose up
```

If your system uses the legacy binary:

```bash
docker-compose up
```

## Just Commands

```bash
just --list
```

Current commands:

- `just run` - run Node server directly
- `just test` - run fixture-based extraction tests
- `just corpus-fetch` - fetch `tests/corpus/urls.txt` into local corpus fixtures
- `just test-corpus` - run extraction tests against fetched corpus fixtures
- `just corpus-report` - generate per-site detected-image report from fetched corpus
- `just docker-build` - build latest container image
- `just docker-run` - run hardened container
- `just ci-lint` - lint GitHub Actions workflows
- `just ci-act-list` - list local `act` workflow jobs
- `just ci-act-validate` - run local `act` validate job
- `just ci-act-docker-build` - run local `act` docker-build job
- `just ci-checks` - run lint + core local CI jobs

## Configuration

Environment variables:

- `HOST` (default `127.0.0.1`)
- `PORT` (default `8788`)
- `IMAGEFETCH_RUNTIME` (default `local`, container sets `container`)
- `MAX_HTML_BYTES` (default `2097152`)
- `MAX_ASSET_BYTES` (default `26214400`)
- `MAX_REQUEST_TARGET_CHARS` (default `4096`)
- `APK_UPGRADE_ON_START` (default `1`, set `0` to skip `apk update && apk upgrade` at container startup)

App version is read from the `VERSION` file at server startup.

## Corpus Workflow

Use this to validate extraction behavior against a real-world URL corpus:

1. Add target URLs to `tests/corpus/urls.txt` (one per line)
2. Fetch snapshots:
   - `just corpus-fetch`
3. Run corpus tests:
   - `just test-corpus`
4. Generate a detection report:
   - `just corpus-report`

Fetched snapshots are stored in `tests/fixtures/corpus/` with an index manifest at `tests/fixtures/corpus/index.tsv`.
Detection report is written to `tests/fixtures/corpus/report.tsv`.

## Security Notes

- SSRF protections block localhost/private address targets
- Only `GET` endpoints are allowed
- Request target length is capped
- HTML and asset response sizes are capped
- Non-image assets are rejected on `/api/asset`
- Security headers are set for all responses

## Contributing

1. Create a branch
2. Make focused changes
3. Validate locally
4. Open a PR with a summary and test notes

## License

MIT. See [LICENSE](./LICENSE).
