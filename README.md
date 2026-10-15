# RAL Browser

An ODX-Browser-style viewer for RAL diagnostic YAML files (`ecus → <ecu> → diagnostics → routine_controls / dids / dtcs / monitors`).

## Run

```sh
npm start            # serves on http://localhost:8080 and auto-loads data/tsg_bfs.yaml
```

You can also open `index.html` directly in a browser and use **File ▸ Open** (Ctrl/Cmd+O) or drag & drop a RAL file. Everything runs locally. No data leaves the machine.

## Sharing (single-file build)

```
npm run build
```

This writes `dist/RAL-Browser.html`, a single self-contained file (about 190 KB) with all CSS, JS and fonts inlined.
Send just that file: the recipient double-clicks it to open it in Chrome, Edge, Safari or Firefox, then opens a
`.ral`/`.yaml` file with **Open** or drag & drop. Nothing is installed or uploaded; the RAL file is parsed
locally in the browser. In this build, Reload re-reads the currently opened file instead of `data/tsg_bfs.yaml`.
Rerun `npm run build` after changing any source file.

## Hosting (GitHub Pages)

`.github/workflows/pages.yml` builds the single-file app on every push to `main` and publishes `dist/` to
GitHub Pages. Only the app is published: `data/` and `*.ral` are git-ignored, and RAL files opened in the
browser are parsed locally and never uploaded.

One-time setup: create the repo in the company org (private or internal), push, then go to
Settings ▸ Pages ▸ Source and choose **GitHub Actions**. Set Pages visibility to **Private** so only
org members can open the URL.

## Layout

- **Location**: the loaded file, its ECUs (B) and variants (E). Selecting one shows an ECU summary.
- **Services**: UDS services derived from the RAL data:
  - `0x10` Diagnostic Session Control (sessions referenced by DIDs/routines)
  - `0x19` Read DTC Information (one entry per DTC)
  - `0x22` / `0x2E` Read / Write Data By Identifier (from each DID's `RDBI` / `WDBI`)
  - `0x27` Security Access (levels referenced by `security_levels`)
  - `0x31` Routine Control (one entry per routine; choose its available Start / Stop / Request Results
    operation in the Request pane dropdown). Edits are preserved separately for each operation;
    Reset values resets only the selected operation.
- **Sub Components**: Monitors (with linked DTC) and DTCs grouped by domain.
- **Request / Responses**: parameter grid with Name, ParamType, DataType, Value, PDU, Unit and Scaling columns. Responses include the positive response, the service negative response and the generic "UDS on CAN" negative response.
- **Details**: ID, sessions, security levels, request PDU and the description text.

## Editing values

- Click **▼** (or double-click a TEXTTABLE value) to open the **Select values** dialog (Text / TI / ID, with `negated`).
- Double-click a numeric, byte-field or string value to type a value. You can enter a physical value, a raw `0x..` value or an enum text.
- The PDU column shows each parameter's raw value. The root row shows the complete encoded message (bitfields packed MSB-first, `endianness: little` honored).

## Parameter mapping

| RAL field | ParamType | DataType |
|---|---|---|
| `enum` only | TEXTTABLE | STRING |
| `scale`/`offset` ≠ 1/0 | LINEAR | FLOAT / INT / UINT |
| `min`/`max`/`unit` | IDENTICAL | UINT |
| `type: string` | IDENTICAL | ASCIISTRING |
| `reserved*` | RESERVED | |
| bitfield > 32 bit, no enum | IDENTICAL | BYTEFIELD |

`min`/`max` are treated as raw limits. Values outside them are shown in red.

## Supported RAL layouts

- Self-contained files and bundles using scalar `!include` and dotted-path `!ref` tags are supported.
  For a bundle, select the main `.ral` **and all companion files** together in Open (multi-select),
  or drag them in together. Selection order does not matter. Include mappings are merged first,
  then the main file's values take precedence; references resolve against the merged document.
  Missing files, unresolved references and cycles are reported as errors, never silently skipped.
  The browser cannot read neighboring files automatically; all companion files must be selected.
- Both the older nested layout (`dids.<name>.did`, `routine_controls.<name>.routine`) and the flat
  schema 1.15+ layout (fields directly on the item) are read.
- `type: field` arrays become STATIC-FIELD / DYNAMIC-LENGTH-FIELD / END-OF-PDU-FIELD rows. Fixed arrays
  repeat `count` times in the PDU; dynamic arrays show `max(min, 1)` example iterations.
- `sint` is encoded as two's complement; `string` with `user_codec: hexstring` is a BYTEFIELD.
- DTCs are grouped by `domain` when the file has it. Otherwise they're grouped by code type
  (P/C/B/U from the top two bits of the DTC). That's the standard UDS/SAE letter, not a RAL domain.
- `dids` entries with `id: null` (e.g. extended-data measurement templates) have no RDBI request.
  They are listed under Sub Components ▸ Data Records (no DID).

## Theme

The UI uses a Scout Motors–inspired theme (Scout orange `#FF5432`, navy `#11232F`, warm neutrals),
taken from the public scoutmotors.com styles. Brand colours live as CSS variables at the top of
`css/styles.css`. IBM Plex Mono (OFL, `vendor/fonts/`) is bundled for values and PDUs. Scout Sans is
proprietary, so it isn't bundled. It's listed first in the font stack and used only if installed;
otherwise system sans-serif fonts are used. Please confirm against the official brand guidelines.
