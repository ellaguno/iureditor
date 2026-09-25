[Leer en español](README.es.md)

# iureditor

Desktop WYSIWYG Markdown editor with live Mermaid diagrams and export to PDF and DOCX.

Built with [Tauri v2](https://tauri.app), React and [TipTap](https://tiptap.dev). Cross-platform: Linux, Windows and macOS.

## Features

- **WYSIWYG editor**: edit markdown as rich text (headings, lists —including nested ones—, tables, tasks, code with syntax highlighting, images, links).
- **Tabs**: several documents open at once, each with its own undo history. `Ctrl+W` closes the tab and `Ctrl+Tab` switches between them.
- **Faithful markdown ↔ HTML round-trip**: `.md` files stay stable when opened and saved.
- **LaTeX formulas**: `$inline$` and `$$block$$` rendered with KaTeX inside the editor; click a formula to edit it.
- **Footnotes**: markdown `[^1]` syntax, with an insert button and automatic numbering. In DOCX they are exported as real Word footnotes.
- **Table of contents**: inserts a table of contents linking to the headings (Edit → Insert table of contents); HTML/PDF exports include the matching anchors.
- **YAML front matter**: the `---` metadata at the top of the file is preserved (visible in the source code view, excluded from exports).
- **Live Mermaid**: ` ```mermaid ` blocks render as diagrams inside the editor; click to edit the code. Export each diagram to SVG or PNG.
- **Export**: PDF (selectable text, vector diagrams, formulas as MathML), DOCX (compatible with Word and LibreOffice) and self-contained HTML.
- **Local images**: paste or drag images and they are saved next to the document in `assets/` with relative references.
- **Draft recovery**: if the app closes unexpectedly, on reopening it offers to recover unsaved work from every tab.
- **Source code view, document outline, find and replace, spell checker, light/dark theme and zoom.**
- **English and Spanish interface**: the app starts in English, or in Spanish if the operating system is set to Spanish; the language can be set in View → Language / Idioma.

## Development

Requirements: Node.js ≥ 20, Rust (stable) and the Tauri dependencies for your platform
(on Linux: `libwebkit2gtk-4.1-dev`, `librsvg2-dev`, `build-essential`, `libssl-dev` — see
[Tauri prerequisites](https://tauri.app/start/prerequisites/)).

```bash
npm install
npm run tauri dev     # desktop app in development mode
npm test              # tests (markdown round-trip)
npm run tauri build   # binaries (AppImage/.deb on Linux)
```

### Troubleshooting on Linux

If the window shows up blank or flickers (NVIDIA/Wayland), try:

```bash
WEBKIT_DISABLE_DMABUF_RENDERER=1 iureditor
```

## Code signing policy

Free code signing provided by [SignPath.io](https://signpath.io), certificate by
[SignPath Foundation](https://signpath.org).

*This is what makes Windows show a known publisher instead of the SmartScreen
warning.*

- **Committers and reviewers:** Eduardo Llaguno ([@ellaguno](https://github.com/ellaguno)).
- **Approvers:** Eduardo Llaguno ([@ellaguno](https://github.com/ellaguno)).
- Every Windows release is built from this repository by GitHub Actions
  (`.github/workflows/release.yml`), submitted to SignPath from that workflow and
  approved manually before it is signed. Only the installer published on the
  [releases page](https://github.com/ellaguno/iureditor/releases) is signed.

### Privacy policy

This program will not transfer any information to other networked systems unless
specifically requested by the user or the person installing or operating it.

Specifically, IureEditor connects only to:

- the Iurefficient instance that the user configures, and only when the user
  signs in or opens, saves or lists documents there;
- `api.github.com`, once a few seconds after start-up, to check whether a newer
  release exists. Nothing is downloaded or installed without asking first.

It collects no telemetry and no usage statistics. Documents are edited locally.
Credentials are stored in the operating system keychain, never in configuration
files.

## License

[MIT](LICENSE)
