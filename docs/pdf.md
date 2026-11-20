# PDF processing and licenses

LumoDossier stores the uploaded bytes and records their SHA-256 hash. Each signing field uses a zero-based page number and a rectangle measured as fractions of the visible page, starting at its top-left corner. The API maps those coordinates through the crop box, page rotation and PDF user unit when it writes the completed copy. It records that copy's SHA-256 separately.

## Dependencies

The versions below were checked against the published packages on November 18, 2026. The workspace lockfile pins the package contents.

| Component | Version and license | Use and provenance |
| --- | --- | --- |
| `@cantoo/pdf-lib` | 2.11.1, MIT | Reads and writes PDFs. The API installs it under the `pdf-lib` import name. Cantoo published this version on September 15, 2026. Its changelog documents ongoing parser, encryption-handling and compression updates. [Published package](https://www.npmjs.com/package/@cantoo/pdf-lib/v/2.11.1) · [Changelog](https://github.com/cantoo-scribe/pdf-lib/blob/master/CHANGELOG.md) · [License](https://github.com/cantoo-scribe/pdf-lib/blob/master/LICENSE.md) |
| `@cantoo/fontkit` | 2.0.12, MIT | Creates embedded font subsets for typed fields. Cantoo published this version on September 11, 2026. The PDF library's maintainers document and recommend this pairing. [Published package](https://www.npmjs.com/package/@cantoo/fontkit/v/2.0.12) · [Font project and license](https://github.com/cantoo-scribe/fontkit) · [Integration instructions](https://github.com/cantoo-scribe/pdf-lib#fontkit-installation) |
| Mozilla PDF.js (`pdfjs-dist`) | 6.5.438, Apache-2.0 | Renders the uploaded document in the sender and recipient browsers. The web build copies its matching worker, fonts, maps and decoder assets. [Mozilla release](https://github.com/mozilla/pdf.js/releases/tag/v6.5.438) · [License](https://github.com/mozilla/pdf.js/blob/master/LICENSE) |
| Liberation Sans Regular and Italic | SIL Open Font License 1.1 | The API embeds subsets from the bundled TrueType files. The font distribution permits commercial embedding. Its original copyright and license accompany the font files. [Bundled notices](../apps/api/assets/LICENSE_LIBERATION) · [OFL terms](https://openfontlicense.org/open-font-license-official-text/) |

Keep the supplied licenses and copyright notices with redistributed dependencies and font assets. The PDF.js distribution includes additional notices alongside its fonts and decoder files.

## Supported input

The upload limit is 15 MiB and 100 pages per document. The API checks the file header, end marker, cross-reference location, page tree and visible dimensions. It checks Flate-compressed page content with a 64 MiB aggregate decompression limit. Encrypted files, dynamic XFA forms and documents containing a prior digital signature require an unlocked, unsigned, static source PDF.

Typed values must be printable in the bundled font. The API checks glyph coverage before accepting each submission. A recipient can also draw a signature or initials. Drawn strokes use normalized points and remain vector paths in the completed PDF.

## Real estate forms

The three original blank forms and their print layout are in `apps/api/assets/real-estate`. To update the blanks, edit `catalog.json`, run `python apps/api/scripts/render_property_templates.py` with ReportLab installed, and review the resulting PDFs. The web build copies the blank PDFs to `/templates/`.

When a sender creates a draft, the API prints the property details onto a private copy. The same layout defines the signature and date rectangles for both parties. Each draft gets its own original hash, recipient IDs and field IDs. [Template walkthrough](../README.md#use-a-real-estate-template)

## Verify placement

Install Poppler and make `pdftoppm` available on the path, or set `PDFTOPPM` to its executable path. Run from the repository root.

```sh
pnpm --filter @lumo/api exec tsx --test test/pdf.test.ts
```

The raster test measures actual ink inside each field and checks asymmetric points in a drawn signature on cropped pages at 0, 90, 180 and 270 degrees. The suite also checks file rejection, dimensions, text validation, original preservation and repeatable completion. Setting `PDF_TEST_ARTIFACT_DIR` to an existing temporary directory retains the disposable completed PDF and rendered pages for inspection.
