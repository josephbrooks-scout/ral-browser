# RAL Browser

An ODX-Browser-style viewer for RAL diagnostic YAML, with a read-only AUTOSAR ARXML workspace,
communication relationship explorer, and file comparison.

## Run

```sh
npm start            # serves on http://localhost:8080 and auto-loads data/tsg_bfs.yaml
```

You can also open `index.html` directly in a browser and use **File ▸ Open** (Ctrl/Cmd+O) or drag & drop RAL or ARXML files. Everything runs locally. No data leaves the machine.

## Sharing (single-file build)

```
npm run build
```

This writes `dist/RAL-Browser.html`, a single self-contained file (about 255 KB) with all CSS, JS and fonts inlined.
Send just that file: the recipient double-clicks it to open it in Chrome, Edge, Safari or Firefox, then opens a
`.ral`/`.yaml`/`.arxml` file with **Open** or drag & drop. Nothing is installed or uploaded; the file is parsed
locally in the browser. In this build, Reload re-reads the currently opened file instead of `data/tsg_bfs.yaml`.
Rerun `npm run build` after changing any source file.

## Hosting (GitHub Pages)

`.github/workflows/pages.yml` builds the single-file app on every push to `main` and publishes `dist/` to
GitHub Pages. Only the app is published: `data/`, `*.ral`, `*.arxml` and `*.7z` are git-ignored, and files opened in the
browser are parsed locally and never uploaded.

One-time setup: create the repo in the company org (private or internal), push, then go to
Settings ▸ Pages ▸ Source and choose **GitHub Actions**. Set Pages visibility to **Private** so only
org members can open the URL.

## Layout

One unified top bar contains menus, toolbar actions, search and the ECU indicator, without a logo/title block.
Controls wrap on narrow windows rather than being clipped. There is no footer
status bar: feedback appears in a floating notification. All notifications, including errors
and warnings, disappear after four seconds.

## ARXML explorer

Open one or more related `.arxml` / AUTOSAR `.xml` files together with **Open**, or drag them into the page.
For `.7z` archives, extract the archive first and open the `.arxml` inside; archives and
Markdown validation reports are not ARXML documents. Processing stays entirely in the browser.

ARXML opens in a separate, read-only explorer, not as synthesized UDS services:

- **Overview** provides category cards with object counts: Networks & ECUs, Signals & Signal Groups,
  PDUs & Frames, Data Types, Software & Interfaces, Scaling/Units/Constraints, and other definitions.
  Only categories present in the file are shown. **Categories** is the default navigation grouping;
  **Packages** preserves the original hierarchy and **Object types** lists the raw AUTOSAR types.
  Use the arrow next to an object, or **Browse all children**, to descend; **Up** and **Home**
  navigate back through the hierarchy.
- The shared search box matches full AUTOSAR paths, object types, and source filenames across the workspace.
- Select an object to see readable property labels alongside original XML paths and attributes.
  Child-object shortcuts and **Referenced by** links expose relationships in both directions.
  Reference links navigate across all loaded ARXML files; **Back** returns.
  Missing targets, conflicting definitions, mismatched namespaces and mismatched `DEST` types are explicitly marked.
- Large lists and property tables are paged in batches of 200. **Show more** reveals the next batch.
  Child shortcuts show the first 20 (with all available in navigation); referring objects page by 20.
- **Add ARXML files** extends the workspace. **Open** replaces it. Remove individual sources from the
  overview; at least one file must remain. **Reload** reparses all current workspace sources.
  Opening a RAL file restores the original diagnostic view. RAL and ARXML cannot be mixed in one import.
  Loaded files are held in memory only; refreshing or closing the browser page clears them.
- **Workspace files** lists filenames, object counts, namespace/schema metadata, and declared
  document-level admin metadata where present. Object-level release/admin data remains in properties.
  Schema filenames are not interpreted as ECU software releases.
- Packages sharing a full path are combined. Identical non-package definitions retain all provenance;
  differing definitions at the same path are flagged as conflicts, with all sources inspectable.
  No reference to a conflicting path is silently resolved. More complex AUTOSAR split definitions
  outside packages are not automatically merged. Duplicate filenames must be renamed before adding.
- **Workspace issues** is a persistent, paged list of conflicting paths and unresolved absolute references.

### Communication

**Communication** groups ECUs, networks/channels, connectors/controllers/ports, frames, PDUs, and signals.
Select an object to follow explicit containment and references in both directions. Frame/PDU mapping
children also expose their connected targets, so you can trace through triggerings and mappings rather
than guessing relationships from names. Links retain their source object, field, and filename.

The detail pane surfaces declared IDs, lengths, start positions, byte order, directions, and transfer
properties. Mapping tables put the target signal/PDU, start bit, byte order and declared length together.
For signals it follows available system-signal, COMPU-method, unit, constraint and base-type
references (up to four hops, cycle-safe). COMPU coefficients remain in their original numerator/denominator
context; the explorer does not assume a simple linear formula. This is not payload decoding, bus
simulation, bit-overlap validation, or AUTOSAR variant evaluation. Reference direction is not Tx/Rx direction.

### Compare files

**Compare files** accepts one baseline and one candidate ARXML file, independently of the workspace;
two revisions can have the same filename. Match objects by full AUTOSAR path and browse **added**,
**removed**, and **changed** definitions, with unchanged counts and paged before/after property tables.
Filter differences by status or search by path/type.

Comparison includes types, reference paths, attributes (including UUIDs), local properties, repeated
values and non-named-child ordering. Nested named objects are compared independently, so their property
changes do not cascade through all ancestor packages. Renames appear as removed + added. Namespace-prefix
spelling, XML comments, formatting between elements, and whitespace-only leaf text are ignored;
other leaf text is compared as declared.
Document-level metadata/schema information is shown separately from named-object counts. This is a
structural definition comparison, not a claim of semantic equivalence or ECU compatibility.
Choosing new comparison files clears the previous report; invalid input is reported explicitly.

The explorer checks XML well-formedness and the AUTOSAR root/namespace, but does **not**
perform XSD/schema validation or establish ECU/UDS behavior. DTD/entity declarations and
duplicate named-object paths within a single source are rejected. There is no physical ECU connection,
approved ECU release baseline, ARXML editing/export, or new DBC/ODX/CDD format support.

Validation: `npm test` runs RAL regressions. To run the browser-specific ARXML tests, serve the app,
load `tests/arxml.browser.js` into the app page, and call `runArxmlTests()` in that page's console.
These use synthetic XML and require no diagnostic data.
For workspace, communication, and comparison regressions, load `tests/workspace.browser.js` and
call `await runWorkspaceTests()`. This tests synthetic split packages, cross-file references, conflicts,
mapping details, comparison, imports, add/remove/reload, and switching back to RAL.
For full-message hex editing UI regressions, load `tests/pdu.browser.js` and call `runPduTests()`;
these use a synthetic RAL fixture and replace the currently displayed data.

## RAL diagnostic view

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
- **Request / Responses**: parameter grid with Name, ParamType, DataType, Bit length, Value, PDU, Unit and Scaling columns.
  Enum fields keep `TEXTTABLE` and readable dropdown labels, but their datatype is `UINT` or `INT`,
  not `STRING`: labels describe numeric encoded choices. Bit length shows each leaf field's declared
  encoded width, including reserved fields; containers have no aggregate width shown.
  True ASCII strings remain `ASCIISTRING`, and hex byte fields remain `BYTEFIELD`.
  Numeric fields whose width is not a whole number of bytes (for example 1, 3, or 12 bits)
  are presented as **BITFIELD**, with their underlying `UINT` / `INT` beneath it and an
  explanatory tooltip. Byte-sized numeric fields retain their normal datatype label.
  This presentation does not change packing, enum choices, or hex decoding.
  Existing saved column widths are preserved with the new bit-length column inserted.
  Responses include the positive response, the service negative response and the generic "UDS on CAN" negative response.
- **Details**: ID, sessions, security levels, request PDU and the description text.

## Editing values

- Click an underlined full-message **PDU hex** value to paste a complete request or response,
  then choose **Apply & decode**. Data fields, enums and scaled values update together;
  changed rows are highlighted with their previous value until another edit or selection.
  Service IDs and matching request parameters remain fixed. Invalid hex, wrong lengths and
  mismatched headers leave all values unchanged. Decoding uses the viewer's sequential layout;
  variable-length arrays, differing repeated-array values, and unverified non-sequential layouts
  are rejected explicitly. This edits the in-memory preview, not the source file or an ECU.
- Click **▼** (or double-click a TEXTTABLE value) to open the **Select values** dialog (Text / TI / ID, with `negated`).
- Double-click a numeric, byte-field or string value to type a value. You can enter a physical value, a raw `0x..` value or an enum text.
- The PDU column shows each parameter's raw value. The root row shows the complete encoded message (bitfields packed MSB-first, `endianness: little` honored).

## Parameter mapping

| RAL field | ParamType | DataType |
|---|---|---|
| `enum` only | TEXTTABLE | UINT / INT |
| `scale`/`offset` ≠ 1/0 | LINEAR | FLOAT / INT / UINT |
| `min`/`max`/`unit` | IDENTICAL | UINT |
| `type: string` | IDENTICAL | ASCIISTRING |
| `reserved*` | RESERVED | |
| bitfield > 32 bit, no enum | IDENTICAL | BYTEFIELD |

`min`/`max` are treated as raw limits. Values outside them are shown in red.

## Supported RAL layouts

- Defaults-based YAML exports (`name`, top-level `dids` / `routine_controls`, and
  per-entry `defaults.ecu`) are converted to the ECU layout. Nested `uint` / `sint` / `string`
  properties supply enums, scaling, limits, defaults and codecs; read/write permissions and
  operation-specific sessions/security are preserved. Non-sequential `start_bit` positions
  produce a persistent import warning: PDU previews pack fields in listed order, so those
  source layouts need verification.
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
