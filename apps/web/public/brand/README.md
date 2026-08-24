# Brand assets

The app ships an **inline vector lockup** for Goyal & Co. | Hariyana Group, drawn
in `src/components/brand/Lockup.tsx`. It needs no files here and renders
correctly in both themes, because its wordmarks inherit the surrounding text
colour.

It is a reconstruction: the wordmarks are set in the app's typeface, not the
original licensed one. Drop your real artwork here for exact fidelity.

## Using the original artwork

Add **`logo.svg`** to this folder. It takes precedence automatically — no code
change, no rebuild config. The file is scaled to fit, preserving aspect ratio.

| File            | Required | Used when                                       |
| --------------- | -------- | ----------------------------------------------- |
| `logo.svg`      | no       | Overrides the inline lockup wherever it appears |
| `logo-dark.svg` | no       | Dark theme, if present                          |
| `mark.svg`      | no       | Collapsed sidebar and mobile header, if present  |

### If your logo is solid black

It will disappear against the dark sidebar. Two fixes, in order of preference:

1. **Add `logo-dark.svg`** — a light-on-dark version. Used automatically in dark
   mode. Preferred, because it keeps your accent colours intact.
2. **Let the app invert it** — with no dark variant, the black artwork is
   inverted in dark mode. Quick, but it flips the accents too, so the amber
   comes out blue.

You can also sidestep the problem the way the inline lockup does: in your
exported SVG, change `fill="#000000"` to `fill="currentColor"` on the text and
logotype paths, leaving the amber and cyan accents as fixed hex. One file then
works on any background.

### Formats

SVG is strongly preferred — the sidebar renders it around 150px wide and a
raster logo softens there. If you only have raster artwork, supply a PNG with a
transparent background at 3× the display size and change the extension in
`src/components/brand/Brand.tsx`.

### Aspect ratio

The full lockup sits in a wide, short slot (roughly 5:1). The artwork's own
pixel dimensions do not matter, but its proportions do — a near-square logo will
render small. If yours is squarish, add `mark.svg` too and it will be used in
tight spaces instead.

## Favicon

Replace `public/favicon.svg`. Its colours are baked rather than inherited, since
a favicon has no page to inherit from. Browsers cache favicons hard, so use a
hard refresh to see a change.

## Exports

PDF and Excel exports carry the logo too, and they do **not** read this folder —
neither pdfmake nor ExcelJS fetches a URL, and a report emailed as an attachment
has no origin to fetch from. The API keeps its own embedded copy at:

```
apps/api/src/assets/brand/logo.jpeg
```

It is a **900px-wide downscale** of the artwork here, on purpose. pdfmake embeds
an image once per reference rather than once per document, and the logo sits in
the running header, so the full-resolution original went into a two-page report
three times and took it from 8KB to 629KB. At 900px it still resolves at roughly
490dpi in the header and 311dpi on the cover.

If you replace the artwork here, replace that file too, keeping it around 900px
wide. `nest-cli.json` copies `src/assets` into `dist` on build; without that the
loader falls back to the source tree, and exports silently print the
organisation's name as text instead — which is the documented behaviour when the
asset is missing, not an error.
