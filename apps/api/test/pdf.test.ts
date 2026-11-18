import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { degrees, PDFDocument, PDFName, PDFNumber } from 'pdf-lib';
import {
  completePdf,
  inspectPdf,
  MAX_PDF_BYTES,
  PdfInputError,
  sha256,
  validatePdfText,
} from '../src/pdf';
import type { FilledField } from '../src/pdf';

async function specimen(rotations = [0, 90, 180, 270]): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  for (const angle of rotations) {
    const page = pdf.addPage([370, 510]);
    page.setMediaBox(-20, -30, 370, 510);
    page.setCropBox(31, 58, 229, 312);
    page.setRotation(degrees(angle));
  }
  return Buffer.from(await pdf.save());
}

function fields(page: number): FilledField[] {
  return [
    { page, x: 0.12, y: 0.1, w: 0.61, h: 0.15, type: 'signature', value: 'Zoë Álvarez' },
    { page, x: 0.11, y: 0.34, w: 0.23, h: 0.11, type: 'initials', value: 'ΖΑ' },
    { page, x: 0.65, y: 0.34, w: 0.2, h: 0.11, type: 'date', value: '2026-01-02' },
    { page, x: 0.11, y: 0.6, w: 0.16, h: 0.18, type: 'checkbox', value: true },
    {
      page,
      x: 0.53,
      y: 0.62,
      w: 0.34,
      h: 0.15,
      type: 'signature',
      value: {
        strokes: [
          [
            [0.06, 0.12],
            [0.24, 0.83],
            [0.92, 0.33],
          ],
          [[0.48, 0.15]],
        ],
      },
    },
    { page, x: 0.11, y: 0.82, w: 0.41, h: 0.13, type: 'text', value: 'Équipe\nБета' },
  ];
}

test('cropped pages expose the visible dimensions after rotation', async () => {
  assert.deepEqual(await inspectPdf(await specimen()), [
    { width: 229, height: 312, rotation: 0 },
    { width: 312, height: 229, rotation: 90 },
    { width: 229, height: 312, rotation: 180 },
    { width: 312, height: 229, rotation: 270 },
  ]);
});

test('nondefault PDF units and crop boxes extending beyond the media are respected', async () => {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([300, 400]);
  page.setCropBox(31, 58, 700, 600);
  page.setRotation(degrees(-90));
  page.node.set(PDFName.of('UserUnit'), PDFNumber.of(2));
  assert.deepEqual(await inspectPdf(Buffer.from(await pdf.save())), [
    { width: 684, height: 538, rotation: 270 },
  ]);
});

test('upload rejects corrupted, non-PDF, encrypted, oversized and out-of-range page counts', async () => {
  await assert.rejects(inspectPdf(Buffer.from('other file')), /Choose a PDF/);
  await assert.rejects(inspectPdf((await specimen()).subarray(0, -10)), /incomplete/);
  await assert.rejects(
    inspectPdf(readFileSync(join(__dirname, 'fixtures/password-protected.pdf'))),
    /encrypted/,
  );
  await assert.rejects(inspectPdf(Buffer.alloc(MAX_PDF_BYTES + 1)), /15 MiB/);
  await assert.rejects(inspectPdf(await specimen(Array(101).fill(0))), /100 pages/);
  const empty = await PDFDocument.create();
  await assert.rejects(
    inspectPdf(Buffer.from(await empty.save({ addDefaultPage: false }))),
    /at least one page/,
  );
  const badOffset = (await specimen()).toString('latin1').replace(/startxref\s+\d+/, 'startxref\n1');
  await assert.rejects(inspectPdf(Buffer.from(badOffset, 'latin1')), /incomplete/);
});

test('upload detects damaged page content, XFA forms and existing digital signatures', async () => {
  const broken = await PDFDocument.create();
  const page = broken.addPage();
  page.node.set(
    PDFName.of('Contents'),
    broken.context.register(broken.context.stream('damaged content', { Filter: 'FlateDecode' })),
  );
  await assert.rejects(inspectPdf(Buffer.from(await broken.save())), /incomplete/);
  const xfa = await PDFDocument.create();
  xfa.addPage();
  xfa.catalog.set(PDFName.of('AcroForm'), xfa.context.obj({ XFA: [] }));
  await assert.rejects(inspectPdf(Buffer.from(await xfa.save())), /XFA/);
  const certified = await PDFDocument.create();
  certified.addPage();
  const signature = certified.context.register(
    certified.context.obj({ Type: 'Sig', Contents: [], ByteRange: [0, 50, 128, 100] }),
  );
  certified.catalog.set(PDFName.of('Perms'), certified.context.obj({ DocMDP: signature }));
  await assert.rejects(
    inspectPdf(Buffer.from(await certified.save())),
    /already contains a digital signature/,
  );
});

test('completion preserves the original and produces repeatable complete files', async () => {
  const original = await specimen([90]);
  const before = Buffer.from(original);
  const final = await completePdf(original, fields(0));
  assert.deepEqual(original, before);
  assert.notEqual(sha256(final), sha256(original));
  assert.deepEqual(final, await completePdf(original, fields(0)));
  const reopened = await PDFDocument.load(final, { updateMetadata: false });
  assert.equal(reopened.getPageCount(), 1);
  assert.equal(reopened.getProducer(), 'LumoDossier');
  assert.equal(reopened.getPage(0).getRotation().angle, 90);
  assert.deepEqual(reopened.getPage(0).getCropBox(), { x: 31, y: 58, width: 229, height: 312 });
});

test('unprintable characters, invalid assignments and out-of-bounds ink are rejected', async () => {
  const doc = await specimen([0]);
  const field = fields(0)[0];
  assert.doesNotThrow(() => validatePdfText('Zoë, Αννα, Ирина', 'signature'));
  assert.throws(() => validatePdfText('😀', 'signature'), PdfInputError);
  await assert.rejects(completePdf(doc, [{ ...field, value: '😀' }]), /cannot be printed/);
  await assert.rejects(completePdf(doc, [{ ...field, x: 0.99 }]), /outside its document page/);
  await assert.rejects(completePdf(doc, [{ ...field, page: 1 }]), /outside its document page/);
  await assert.rejects(
    completePdf(doc, [{ ...field, value: { strokes: [[[6, 0.5]]] } }]),
    /outside its field/,
  );
  await assert.rejects(completePdf(doc, [{ ...field, value: { strokes: [] } }]), /Draw a signature/);
  await assert.rejects(
    completePdf(doc, [{ ...field, type: 'checkbox', value: 'yes' }]),
    /does not match/,
  );
});

function readGrayscale(file: string) {
  const data = readFileSync(file);
  const header = /^P5\s+(\d+)\s+(\d+)\s+255(?:\r\n|\n)/.exec(data.subarray(0, 80).toString('latin1'));
  assert.ok(header, 'expected a binary grayscale image');
  const width = Number(header[1]);
  const height = Number(header[2]);
  const pixels = data.subarray(header[0].length);
  assert.equal(pixels.length, width * height);
  return { width, height, pixels };
}

const pdftoppm = process.env.PDFTOPPM || 'pdftoppm';
const installed = spawnSync(pdftoppm, ['-v'], { windowsHide: true }).status === 0;
test(
  'Poppler renders every completed field inside its intended visible rectangle on all four rotations',
  {
    skip:
      !installed &&
      !process.env.PDFTOPPM &&
      'Set PDFTOPPM to the pdftoppm executable to run the raster check.',
  },
  async () => {
    const folder = mkdtempSync(join(process.env.PDF_TEST_ARTIFACT_DIR || tmpdir(), 'lumo-pdf-'));
    try {
      const original = await specimen();
      const byPage = [0, 1, 2, 3].map(fields);
      const file = join(folder, 'completed.pdf');
      writeFileSync(file, await completePdf(original, byPage.flat()));
      const result = spawnSync(pdftoppm, ['-cropbox', '-r', '72', '-gray', file, join(folder, 'page')], {
        windowsHide: true,
      });
      assert.equal(result.status, 0, result.stderr?.toString());
      for (const [page, marks] of byPage.entries()) {
        const { pixels, width, height } = readGrayscale(join(folder, `page-${page + 1}.pgm`));
        assert.equal(width, page % 2 ? 312 : 229);
        assert.equal(height, page % 2 ? 229 : 312);
        const counts = marks.map(() => 0);
        for (let i = 0; i < pixels.length; i++) {
          if (pixels[i] >= 155) continue;
          const x = ((i % width) + 0.5) / width;
          const y = (Math.floor(i / width) + 0.5) / height;
          const inside = marks.findIndex(
            (mark) =>
              x >= mark.x - 1 / width &&
              x <= mark.x + mark.w + 1 / width &&
              y >= mark.y - 1 / height &&
              y <= mark.y + mark.h + 1 / height,
          );
          assert.notEqual(inside, -1, `Unexpected ink on page ${page + 1} at (${x}, ${y})`);
          counts[inside]++;
        }
        counts.forEach((count, i) =>
          assert.ok(count > 8, `Missing ${marks[i].type} on page ${page + 1}`),
        );
        // Distinct corners of the handwritten stroke also detect a mirrored field.
        const drawing = marks[4];
        for (const [fx, fy] of [
          [0.06, 0.12],
          [0.24, 0.83],
          [0.92, 0.33],
        ]) {
          const px = Math.round(width * (drawing.x + fx * drawing.w));
          const py = Math.round(height * (drawing.y + fy * drawing.h));
          let ink = 0;
          for (let y = py - 3; y <= py + 3; y++) {
            for (let x = px - 3; x <= px + 3; x++) if (pixels[y * width + x] < 155) ink++;
          }
          assert.ok(ink > 0, `Handwritten point on page ${page + 1} was rotated or mirrored`);
        }
      }
    } finally {
      if (!process.env.PDF_TEST_ARTIFACT_DIR) {
        for (const name of readdirSync(folder)) unlinkSync(join(folder, name));
        rmdirSync(folder);
      }
    }
  },
);
