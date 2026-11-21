![iureditor](img/iureditor.png)

# iureditor help

**iureditor** is a WYSIWYG Markdown editor: you write with visual formatting and the
document is saved as clean, portable Markdown. It includes live Mermaid diagrams,
images, tables, footnotes, formulas and export to PDF, DOCX and HTML.

> [!TIP]
> This document is itself an example of what you can create. Open the
> **Document outline** panel (Ctrl+Shift+O) to navigate it like a live table of contents.

## Contents

1. The interface at a glance
2. The toolbar
3. The menu (☰)
4. Tabs and windows
5. Side panel
6. Links between notes
7. Source code view
8. Inserting content
9. The “/” quick menu
10. Find and replace
11. Export
12. Templates
13. Appearance and reading
14. Keyboard shortcuts
15. Updates

---

## 1. The interface at a glance

![Map of the iureditor interface](data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI2NDAiIGhlaWdodD0iMzYwIiB2aWV3Qm94PSIwIDAgNjQwIDM2MCIgZm9udC1mYW1pbHk9InN5c3RlbS11aSxTZWdvZSBVSSxSb2JvdG8sc2Fucy1zZXJpZiI+CiAgPHJlY3QgeD0iMSIgeT0iMSIgd2lkdGg9IjYzOCIgaGVpZ2h0PSIzNTgiIHJ4PSIxMCIgZmlsbD0iI2ZmZmZmZiIgc3Ryb2tlPSIjY2JkNWUxIi8+CiAgPCEtLSBUaXRsZSBiYXIgLS0+CiAgPHJlY3QgeD0iMSIgeT0iMSIgd2lkdGg9IjYzOCIgaGVpZ2h0PSI0NiIgcng9IjEwIiBmaWxsPSIjZjFmNWY5Ii8+CiAgPHJlY3QgeD0iMSIgeT0iMzYiIHdpZHRoPSI2MzgiIGhlaWdodD0iMTEiIGZpbGw9IiNmMWY1ZjkiLz4KICA8cmVjdCB4PSIxNiIgeT0iMTQiIHdpZHRoPSIyMCIgaGVpZ2h0PSIyMCIgcng9IjUiIGZpbGw9IiNlMmU4ZjAiIHN0cm9rZT0iIzk0YTNiOCIvPgogIDxyZWN0IHg9IjQ0IiB5PSIxNCIgd2lkdGg9IjIwIiBoZWlnaHQ9IjIwIiByeD0iNSIgZmlsbD0iI2RiZWFmZSIgc3Ryb2tlPSIjNjBhNWZhIi8+CiAgPHJlY3QgeD0iODAiIHk9IjE1IiB3aWR0aD0iOTYiIGhlaWdodD0iMTgiIHJ4PSI2IiBmaWxsPSIjZmZmZmZmIiBzdHJva2U9IiNjYmQ1ZTEiLz4KICA8cmVjdCB4PSIxODQiIHk9IjE1IiB3aWR0aD0iOTYiIGhlaWdodD0iMTgiIHJ4PSI2IiBmaWxsPSIjZTJlOGYwIi8+CiAgPGNpcmNsZSBjeD0iNTg2IiBjeT0iMjQiIHI9IjgiIGZpbGw9IiNlMmU4ZjAiLz4KICA8Y2lyY2xlIGN4PSI2MDgiIGN5PSIyNCIgcj0iOCIgZmlsbD0iI2UyZThmMCIvPgogIDxjaXJjbGUgY3g9IjYyNiIgY3k9IjI0IiByPSI4IiBmaWxsPSIjZmVjYWNhIi8+CiAgPHRleHQgeD0iNzAiIHk9IjI4IiBmb250LXNpemU9IjExIiBmaWxsPSIjMzM0MTU1IiB0ZXh0LWFuY2hvcj0iZW5kIj7imLA8L3RleHQ+CiAgPHRleHQgeD0iMTI4IiB5PSIyNyIgZm9udC1zaXplPSIxMCIgZmlsbD0iIzMzNDE1NSIgdGV4dC1hbmNob3I9Im1pZGRsZSI+ZG9jdW1lbnQubWQ8L3RleHQ+CiAgPCEtLSBUb29sYmFyIC0tPgogIDxyZWN0IHg9IjEiIHk9IjQ3IiB3aWR0aD0iNjM4IiBoZWlnaHQ9IjM0IiBmaWxsPSIjZmZmZmZmIiBzdHJva2U9IiNlMmU4ZjAiLz4KICA8ZyBmaWxsPSIjNDc1NTY5Ij4KICAgIDxyZWN0IHg9IjE0IiB5PSI1NyIgd2lkdGg9IjE2IiBoZWlnaHQ9IjE0IiByeD0iMyIvPjxyZWN0IHg9IjM0IiB5PSI1NyIgd2lkdGg9IjE2IiBoZWlnaHQ9IjE0IiByeD0iMyIvPgogICAgPHJlY3QgeD0iNjIiIHk9IjU3IiB3aWR0aD0iMTYiIGhlaWdodD0iMTQiIHJ4PSIzIi8+PHJlY3QgeD0iODIiIHk9IjU3IiB3aWR0aD0iMTYiIGhlaWdodD0iMTQiIHJ4PSIzIi8+PHJlY3QgeD0iMTAyIiB5PSI1NyIgd2lkdGg9IjE2IiBoZWlnaHQ9IjE0IiByeD0iMyIvPgogICAgPHJlY3QgeD0iMTMwIiB5PSI1NyIgd2lkdGg9IjE2IiBoZWlnaHQ9IjE0IiByeD0iMyIvPjxyZWN0IHg9IjE1MCIgeT0iNTciIHdpZHRoPSIxNiIgaGVpZ2h0PSIxNCIgcng9IjMiLz4KICAgIDxyZWN0IHg9IjE3OCIgeT0iNTciIHdpZHRoPSIxNiIgaGVpZ2h0PSIxNCIgcng9IjMiLz48cmVjdCB4PSIxOTgiIHk9IjU3IiB3aWR0aD0iMTYiIGhlaWdodD0iMTQiIHJ4PSIzIi8+PHJlY3QgeD0iMjE4IiB5PSI1NyIgd2lkdGg9IjE2IiBoZWlnaHQ9IjE0IiByeD0iMyIvPgogIDwvZz4KICA8dGV4dCB4PSIzMzAiIHk9IjY4IiBmb250LXNpemU9IjExIiBmaWxsPSIjOTRhM2I4Ij5mb3JtYXR0aW5nIHRvb2xiYXLigKY8L3RleHQ+CiAgPCEtLSBTaWRlYmFyIC0tPgogIDxyZWN0IHg9IjEiIHk9IjgxIiB3aWR0aD0iMTUwIiBoZWlnaHQ9IjI0OCIgZmlsbD0iI2Y4ZmFmYyIgc3Ryb2tlPSIjZTJlOGYwIi8+CiAgPHRleHQgeD0iMTYiIHk9IjEwMiIgZm9udC1zaXplPSIxMSIgZmlsbD0iIzY0NzQ4YiIgZm9udC13ZWlnaHQ9IjYwMCI+RklMRVMgLyBPVVRMSU5FPC90ZXh0PgogIDxnIGZpbGw9IiNjYmQ1ZTEiPjxyZWN0IHg9IjE2IiB5PSIxMTYiIHdpZHRoPSIxMTgiIGhlaWdodD0iOCIgcng9IjQiLz48cmVjdCB4PSIxNiIgeT0iMTM0IiB3aWR0aD0iMTAwIiBoZWlnaHQ9IjgiIHJ4PSI0Ii8+PHJlY3QgeD0iMjgiIHk9IjE1MiIgd2lkdGg9IjkwIiBoZWlnaHQ9IjgiIHJ4PSI0Ii8+PHJlY3QgeD0iMjgiIHk9IjE3MCIgd2lkdGg9Ijk0IiBoZWlnaHQ9IjgiIHJ4PSI0Ii8+PHJlY3QgeD0iMTYiIHk9IjE4OCIgd2lkdGg9IjExMCIgaGVpZ2h0PSI4IiByeD0iNCIvPjwvZz4KICA8IS0tIEVkaXRvciAtLT4KICA8cmVjdCB4PSIxNTEiIHk9IjgxIiB3aWR0aD0iNDg4IiBoZWlnaHQ9IjI0OCIgZmlsbD0iI2ZmZmZmZiIvPgogIDxyZWN0IHg9IjIxMCIgeT0iMTA0IiB3aWR0aD0iMzcwIiBoZWlnaHQ9IjE2IiByeD0iNCIgZmlsbD0iI2UyZThmMCIvPgogIDxnIGZpbGw9IiNlZWYyZjciPjxyZWN0IHg9IjIxMCIgeT0iMTM2IiB3aWR0aD0iMzYwIiBoZWlnaHQ9IjkiIHJ4PSI0Ii8+PHJlY3QgeD0iMjEwIiB5PSIxNTQiIHdpZHRoPSIzNzIiIGhlaWdodD0iOSIgcng9IjQiLz48cmVjdCB4PSIyMTAiIHk9IjE3MiIgd2lkdGg9IjMzMCIgaGVpZ2h0PSI5IiByeD0iNCIvPjwvZz4KICA8cmVjdCB4PSIyMTAiIHk9IjIwMCIgd2lkdGg9IjE4MCIgaGVpZ2h0PSIxNCIgcng9IjQiIGZpbGw9IiNkYmVhZmUiLz4KICA8ZyBmaWxsPSIjZWVmMmY3Ij48cmVjdCB4PSIyMTAiIHk9IjIyOCIgd2lkdGg9IjM2MCIgaGVpZ2h0PSI5IiByeD0iNCIvPjxyZWN0IHg9IjIxMCIgeT0iMjQ2IiB3aWR0aD0iMzAwIiBoZWlnaHQ9IjkiIHJ4PSI0Ii8+PC9nPgogIDwhLS0gU3RhdHVzIGJhciAtLT4KICA8cmVjdCB4PSIxIiB5PSIzMjkiIHdpZHRoPSI2MzgiIGhlaWdodD0iMzAiIHJ4PSIxMCIgZmlsbD0iI2YxZjVmOSIvPgogIDxyZWN0IHg9IjEiIHk9IjMyOSIgd2lkdGg9IjYzOCIgaGVpZ2h0PSIxMSIgZmlsbD0iI2YxZjVmOSIvPgogIDx0ZXh0IHg9IjE2IiB5PSIzNDkiIGZvbnQtc2l6ZT0iMTAiIGZpbGw9IiM2NDc0OGIiPjEsMjM0IHdvcmRzIMK3IDcsODkwIGNoYXJhY3RlcnM8L3RleHQ+CiAgPHRleHQgeD0iNjI0IiB5PSIzNDkiIGZvbnQtc2l6ZT0iMTAiIGZpbGw9IiM2NDc0OGIiIHRleHQtYW5jaG9yPSJlbmQiPk1hcmtkb3duIMK3IFVURi04PC90ZXh0PgogIDwhLS0gbGFiZWxzIC0tPgogIDx0ZXh0IHg9IjMwMCIgeT0iMzQiIGZvbnQtc2l6ZT0iMTAiIGZpbGw9IiMxZDRlZDgiIGZvbnQtd2VpZ2h0PSI2MDAiPnRhYnM8L3RleHQ+Cjwvc3ZnPgo=)

From top to bottom:

- **Title bar**: the ☰ button opens the main menu, next to it are the
  **tabs** of the open documents and, on the right, the window buttons.
- **Toolbar**: formatting buttons for the active document.
- **Side panel** (left): tabs for **Files** (with search in files), the document
  **Outline**, the note's **Links**, **Iurefficient** and the **Assistant** (sparkles
  icon). Hide it with the corner
  button.
- **Editing area**: the document, exactly as it will look.
- **Status bar** (bottom): word and character count, and the file format.

## 2. The toolbar

![Toolbar groups](data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI2NDAiIGhlaWdodD0iMTUwIiB2aWV3Qm94PSIwIDAgNjQwIDE1MCIgZm9udC1mYW1pbHk9InN5c3RlbS11aSxTZWdvZSBVSSxSb2JvdG8sc2Fucy1zZXJpZiI+CiAgPHJlY3QgeD0iMSIgeT0iMSIgd2lkdGg9IjYzOCIgaGVpZ2h0PSIxNDgiIHJ4PSIxMCIgZmlsbD0iI2ZmZmZmZiIgc3Ryb2tlPSIjY2JkNWUxIi8+CiAgPGcgZm9udC1zaXplPSIxMSIgZmlsbD0iIzFlMjkzYiIgZm9udC13ZWlnaHQ9IjYwMCI+CiAgICA8dGV4dCB4PSIyMCIgeT0iMjgiPlVuZG8gLyByZWRvPC90ZXh0PgogICAgPHRleHQgeD0iMjAiIHk9IjUyIj5IZWFkaW5ncyBIMeKAk0gzPC90ZXh0PgogICAgPHRleHQgeD0iMjAiIHk9Ijc2Ij5Gb3JtYXR0aW5nOiBib2xkLCBpdGFsaWMsIHVuZGVybGluZSwgY29kZSwgc3ViL3N1cGVyc2NyaXB0PC90ZXh0PgogICAgPHRleHQgeD0iMjAiIHk9IjEwMCI+Q29sb3IgYW5kIGhpZ2hsaWdodCDCtyBBbGlnbm1lbnQgwrcgTGlzdHM8L3RleHQ+CiAgICA8dGV4dCB4PSIyMCIgeT0iMTI0Ij5CbG9ja3M6IHF1b3RlLCBjb2RlLCBydWxlLCBNZXJtYWlkLCBmb290bm90ZSwgZm9ybXVsYSwgbGluaywgaW1hZ2UsIHRhYmxlPC90ZXh0PgogIDwvZz4KICA8ZyBmaWxsPSIjM2I4MmY2Ij48Y2lyY2xlIGN4PSIxMCIgY3k9IjI0IiByPSIzIi8+PGNpcmNsZSBjeD0iMTAiIGN5PSI0OCIgcj0iMyIvPjxjaXJjbGUgY3g9IjEwIiBjeT0iNzIiIHI9IjMiLz48Y2lyY2xlIGN4PSIxMCIgY3k9Ijk2IiByPSIzIi8+PGNpcmNsZSBjeD0iMTAiIGN5PSIxMjAiIHI9IjMiLz48L2c+Cjwvc3ZnPgo=)

Buttons are grouped by function. Hover over any of them to see its name and
shortcut.

## 3. The menu (☰)

The main menu is organized in **collapsible sections**. Click a section title to
expand or collapse it; you can keep several open at once or close them all to
see the rest.

- **File**: new, open, open folder, templates, recent, save, export and quit.
- **Edit**: undo/redo, find and replace, insert table of contents and select all.
- **View**: panels, zoom, page width, theme, spell checker and language.
- **Help**: this help, Iurefficient links, check for updates and version.

## 4. Tabs and windows

- Each document lives in a **tab**. Drag tabs to reorder them.
- The **+** button (or Ctrl+N) opens a new tab.
- **Right-click** a tab: reload, close, close others/tabs to the right, or
  **move it to a new window**.
- The blue dot means the tab has **unsaved changes**.

## 5. Side panel

- **Files** (Ctrl+Shift+E): browse and open the files in the current folder and
  create new documents and folders. **Right-click** a file to **rename** it (see
  “Links between notes”); right-click a folder to **use it as the vault**.
- **Search in files** (Ctrl+Shift+F, or the **magnifier** in the Files header):
  finds text in every file of the folder; click a result to open it at that
  line. The ← arrow (or Esc) goes back to the file tree.
- **Outline** (Ctrl+Shift+O): lists the headings like a table of contents; click
  one to jump to that section.
- **Links** (Ctrl+Shift+K): which notes link to the one you are viewing and which
  ones it links to (see the next section).
- **Assistant** (Ctrl+Shift+J): questions to the Iurefficient AI with your
  account connected. If the document is saved in a project, it searches its
  documents and cites the sources; otherwise it uses the general chat. Below the
  question you choose what goes with it: nothing, the **selection** or the whole
  **document**. The magnifier button **analyzes the document**: review of
  inconsistencies, summary, what is missing and, in a project, a check against
  the project. **Insert** puts the answer after the cursor and **Replace** puts it
  in place of the selection. Each question uses AI quota.

## 6. Links between notes

iureditor can work as a notebook of linked notes, Obsidian style: a note points to
another one with `[[Note name]]`, and you can jump between them, see what links
to what and rename without breaking anything.

### The vault

Links are looked up inside a **vault**: the folder that holds your notes (and its
subfolders). iureditor picks it like this:

1. The folder you opened with **File → Open folder…**, or the one you marked with
   **right-click → Use as vault** in the Files panel (shown with a small books
   icon).
2. Otherwise, the closest folder that contains a `.obsidian` folder: **an Obsidian
   vault works as is**.
3. Otherwise, the folder of the document you are editing.

> [!TIP]
> To get started, create a folder for your notes and open it with **File → Open
> folder…**. From then on, every note in that folder can link to the others.

### Creating a link

Type **`[[`** and a list of the notes in the vault appears. Keep typing to filter
it (no need for the exact name or accents) and press **Enter** or **Tab** to insert
the link. If the note does not exist, the last option is **Create note “…”**.

| You type | Result |
| --- | --- |
| `[[Project]]` | Link to the note *Project.md* |
| `[[Project#Plan]]` | Link to the *Plan* section of that note (after `#` the list offers its headings) |
| `[[Project|the project]]` | Link that reads “the project” |
| `[[#Plan]]` | Link to a section of the same note |
| `![[diagram.png]]` | Embed: link to a file in the vault |

You can also type the whole link by hand: closing it with **`]]`** turns it into a
link. The file stores exactly that, `[[…]]`, so your notes stay portable
Markdown.

### Using links

- **Click** a link: opens the note (and jumps to the section, if any). A file that
  is not a note opens with the system application.
- A **grey, dotted** link points to a note that **does not exist yet**; clicking it
  creates it next to the current note and opens it.
- To **edit** a link, put the cursor right after it and press **Backspace**: it
  turns back into `[[…` text with the list open.
- Regular Markdown links to other notes (`[text](other-note.md)`) count as links
  too.

### The Links panel

With **Ctrl+Shift+K** (or the **Links** tab of the side panel) you see, for the
active note:

- **Backlinks**: the notes that link to this one, with the line where they do.
  Click one to open it right at the link.
- **Outgoing links**: the notes this one points to (the ones that do not exist
  yet in grey; clicking them creates them).
- **Unlinked mentions**: notes that write this note's name without linking it;
  handy to discover connections.

The top of the panel shows which vault is in use and how many notes it has.

> [!NOTE]
> The panel reflects what is **saved**: save the note (Ctrl+S) to see its new
> links. Changes made outside iureditor are picked up when you return to its
> window.

### Renaming without breaking links

Right-click a file in the Files panel → **Rename…**. If other notes link to it,
iureditor asks whether to **update** those links (on disk and in open tabs,
without losing unsaved changes or undo history). Sections and aliases are kept:
`[[Idea|my idea]]` becomes `[[New idea|my idea]]`.

### Go to note and command palette

- **Ctrl+K — Go to note**: type part of a note's name (or folder) and press Enter
  to open it. If it does not exist, you can create it from there.
- **Ctrl+Shift+P — Command palette**: find and run any menu action by name. In
  “Go to note”, typing `>` first also switches to commands.

## 7. Source code view

**Ctrl+Shift+M** switches between the visual view and the raw **Markdown**, with
syntax highlighting. Useful for fine-tuning or pasting existing Markdown.

**Ctrl+Shift+N** shows or hides **line numbers** (in both views). **Ctrl+L** jumps
to a given line.

## 8. Inserting content

From the toolbar or the “/” menu you can insert:

- **Headings** H1–H3, **lists** (bulleted, numbered and task lists).
- **Formatting**: bold, italic, underline, strikethrough, code, sub/superscript,
  color and highlight.
- **Tables**: insert and edit rows and columns.
- **Images**: from a file or a URL. Local images are saved with a relative path so
  the document stays portable.
- **Links**, **quotes**, **code blocks**, **horizontal rules**.
- **Mermaid diagrams** with live preview, templates and, with your Iurefficient
  account connected, an **assistant** that drafts or changes them from a
  description.
- **Footnotes** and **inline formulas** (LaTeX/KaTeX).
- **Callouts** (notices like this one):

> [!NOTE]
> Type `> [!NOTE]`, `> [!TIP]`, `> [!WARNING]`, etc. at the start of a quote
> to turn it into a callout with color and icon.

- **Table of contents**: *Edit → Insert table of contents* builds one from the
  document headings.
- **Mind map**: with the cursor in a list, the toolbar's mind map button turns it
  into a map (the paragraph right before it is the center); click again to undo.
  You can also type `/mind` or `> [!MINDMAP] Center` followed by an indented
  list. The map is drawn next to the list as you type: each indent level is a
  branch. Bold, italics and `[[links]]` show up in the map.
  The map is editable too: clicking a node puts the cursor on its list item
  (double-click selects its text) and the bar under the node adds a child or
  sibling branch, deletes it or opens the linked note (Ctrl+click works too). The header lets you pick the node
  shape (underlined, square, rounded, circle, cloud, bang or hexagon; saved as
  `> [!MINDMAP|bang]`) and the view: list with the map
  below, list and map side by side, or map only (the list is hidden and edited
  from the map). It is saved in the document (`|right`, `|map`).
- **Link map**: `/links` inserts a mind map with the note at the center, its
  `[[links]]` as branches, those notes' links as sub-branches and a branch with the
  notes that link here. Edit it like any other map; the ⟳ button
  in its header regenerates it from the current links (Ctrl+Z undoes it). The
  exported PDF, DOCX and HTML show it as it looks: with the
  list or, in the map-only view, just the map.

## 9. The “/” quick menu

Type **/** at the start of an empty line to open a quick insert menu (headings,
lists, table, image, code, Mermaid, callout…). Type to filter and press Enter to
confirm.

## 10. Find and replace

**Ctrl+F** opens the search bar, with match highlighting, both in the visual view
and in the source code view. **Ctrl+H** opens it with the **replace** field already
shown.

To search **every file in the folder**, use **Ctrl+Shift+F** (the magnifier in the
Files panel).

## 11. Export

From *File → Export*:

- **PDF** (Ctrl+P): opens the print preview; **Save PDF** writes the file directly
  (with its name and folder already suggested) and **Print…** sends it to a
  printer. Keeps styles, images, diagrams and page breaks.
- **DOCX**: editable Word document.
- **HTML**: standalone page with embedded styles.

## 12. Templates

Put `.md` files in the templates folder (*File → New from template → Open
templates folder*) and they will show up as starting points for new documents.
`{{date}}` in a template is replaced with today's date.

## 13. Appearance and reading

- **Theme**: light, dark or follow the system.
- **Page width** (Ctrl+Shift+A): medium, wide or full.
- **Zoom**: Ctrl++, Ctrl+- and Ctrl+0 to reset.
- **Spell checker**: turn it on or off from *View*.
- **Language / Idioma**: English, Spanish or automatic (follows the system
  language), from *View*.

## 14. Keyboard shortcuts

| Action | Shortcut |
| --- | --- |
| New / Open | Ctrl+N · Ctrl+O |
| Save / Save as | Ctrl+S · Ctrl+Shift+S |
| Export to PDF | Ctrl+P |
| Undo / Redo | Ctrl+Z · Ctrl+Shift+Z |
| Find / Replace | Ctrl+F · Ctrl+H |
| Select all | Ctrl+A |
| Files / outline panel | Ctrl+Shift+E · Ctrl+Shift+O |
| Search in files | Ctrl+Shift+F |
| Go to note | Ctrl+K |
| Command palette | Ctrl+Shift+P |
| Links panel | Ctrl+Shift+K |
| Source code | Ctrl+Shift+M |
| Line numbers / Go to line | Ctrl+Shift+N · Ctrl+L |
| Help (this document) | F1 |
| Page width | Ctrl+Shift+A |
| Zoom + / − / reset | Ctrl++ · Ctrl+- · Ctrl+0 |
| Close tab / Quit | Ctrl+W · Ctrl+Q |

## 15. Updates

*Help → Check for updates…* tells you whether a new version is available. The
installed version is shown at the bottom of the **Help** menu.

---

*iureditor — a product of [Iurefficient](https://iurefficient.com).*
