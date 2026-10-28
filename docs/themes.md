# Themes

Themes change colors only. Fonts, spacing, geometry, icons, and motion remain
shared across the app. The picker presents one flat list of named themes.
Carbon preserves the original palette and is the default; Paper, Midnight,
and Catppuccin Mocha remain available alongside these additions:

| Theme | Native scheme | Palette |
| --- | --- | --- |
| Jungle Radio | Dark | Forest green and electric lime |
| Cherry Cola | Dark | Burgundy, cream, and peach |
| Saffron Milk | Light | Custard yellow and toasted orange |
| Cobalt Crush | Dark | Saturated ultramarine and citron |
| Matcha | Light | Pale pistachio and moss green |
| Poolside | Light | Mint water and crisp pool blue |
| Guava | Light | Blush pink and raspberry |
| Arcade | Dark | Black violet and hot pink |
| Lagoon | Dark | Deep tropical teal and sea glass |
| Rosé Pine Dawn | Light | Warm porcelain, dusty rose, and plum |
| Gruvbox | Dark | Warm charcoal, parchment, and earthy gold |
| Dracula | Dark | Charcoal violet and bright pink |

Catppuccin Mocha uses the [official Catppuccin palette](https://catppuccin.com/palette/#mocha):
Base for the canvas, Mantle for secondary panes, Surface 0 for option rows,
and Mauve for the accent. Nutrition keeps Blue, Peach, Teal, and Mauve for
kcal/P/C/F; dimmed progress segments blend those colors toward Base.

Rosé Pine Dawn, Gruvbox, and Dracula adapt their
[official Rosé Pine](https://rosepinetheme.com/palette/),
[Gruvbox](https://github.com/morhetz/gruvbox), and
[Dracula](https://github.com/dracula/dracula-theme) palettes. Their semantic
text and nutrition colors are tuned for readable app controls and surfaces,
while retaining each palette's canvas and character. The other additions
are original kcal palettes.

The preference belongs to this browser. Selecting a theme applies it immediately
and saves it locally; it is independent of goal Save/Cancel and survives logout.
Other tabs follow preference changes. Unavailable storage does not prevent
changing the current page's theme. Missing or unknown preferences fall back to
Carbon. The native-control color scheme is an internal palette detail, not a
theme category shown in the picker.

## Adding a theme

1. Add a complete `[data-theme="stable-id"]` block to `src/themes.css`, after the
   Carbon default. Copy every color token and set the appropriate `color-scheme`.
   Keep the ID stable because browsers persist it.
2. Add the same ID and its display metadata to the catalog in `src/themes.ts`.
   The catalog drives the picker; do not add theme-specific branches to
   components or copy palette values into TypeScript.

Palette values have one source: CSS. The selectors also support a scoped element
with `data-theme` for a palette preview. Every palette defines its full token set
so that it does not accidentally inherit colors from the current page theme.
The `:root` selector shares Carbon's declarations for unknown or absent IDs;
named palette blocks must follow it in the stylesheet.

## Color roles

| Tokens | Purpose |
| --- | --- |
| `--bg`, `--bg-elev`, `--bg-elev-2` | Canvas, raised surfaces, and inset/secondary surfaces |
| `--border`, `--border-strong` | Separators and more visible control boundaries |
| `--fg`, `--fg-dim`, `--fg-dimmer` | Primary and secondary text |
| `--accent`, `--accent-ink` | Selected/action surfaces and their text/icons |
| `--danger`, `--danger-ink` | Errors/destructive surfaces and text/icons on filled destructive actions |
| `--kcal`, `--macro-p`, `--macro-c`, `--macro-f` | Calories, protein, carbs, and fat |
| `--kcal-dim`, `--macro-p-dim`, `--macro-c-dim`, `--macro-f-dim` | Existing portions in stacked progress bars |
| `--overlay` | Backdrop behind a Sheet |
| `--scanner-overlay` | Scanner backdrop beneath its text and controls |

Use paired ink tokens on filled actions. `--bg` is a surface, not a substitute
for `--accent-ink` or `--danger-ink`. Keep the familiar macro color meanings
recognizable across palettes. Native date/time inputs and selection controls
inherit the palette's `color-scheme`; do not force a scheme in their modules.

The scanner uses the normal text tokens, so its backdrop must support those
colors. In Paper it is a nearly opaque light surface; the ordinary Sheet uses a
dark translucent scrim instead. Check the scan line and corners against camera
imagery separately from text-on-surface contrast.
Carbon retains the original effective 60% scanner scrim. The scanner modifier
explicitly overrides the shared overlay rule so other palettes can use a
different backdrop from Sheets.

## Startup and browser appearance

The head preference bootstrap selects `data-theme` before the directly linked
palette stylesheet paints the document canvas. Keep the remaining global styles
imported after the application components in `main.tsx`: moving them ahead of
component styles changes the existing utility-class typography and spacing.
Do not move palette loading exclusively into JavaScript or defer selection to an effect: applying a
theme before Preact renders is not sufficient to guarantee the first document
paint uses it.

The app controller owns subsequent selection, storage changes, and best-effort
browser metadata updates. Browser chrome colors come from the active CSS palette,
not duplicate catalog values. Installed-app launch surfaces and icons still use
the static manifest/branding defaults; runtime selection cannot promise to
recolor every operating-system surface.

## Validation

- Check all required tokens and each catalog/selector ID when adding a palette.
- Check primary, secondary, macro, and danger text against all three surfaces;
  target at least 4.5:1 contrast for ordinary text. Check accent/danger ink against
  their filled surfaces, and inspect progress bars, focus indicators, and controls.
- Inspect Home, Settings, product and amount forms, weights, selection actions,
  Sheet backdrops, and the scanner. Include real camera imagery for scan markers.
- Confirm a goals draft survives opening Themes, switching themes, and returning.
  Back restores launcher focus; only the visible Sheet pane handles scrolling.
- Check persistence on reload, changes from another tab, unknown IDs, and storage
  failure. Verify Carbon retains the original appearance.
- Verify first paint against the production build with a saved non-default
  theme and the app module response held back. Check the computed canvas color
  before releasing JavaScript; checking only `data-theme` or waiting for page
  load can miss an initial flash.
