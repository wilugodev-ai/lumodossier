import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';
import fontkit from '@cantoo/fontkit';
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFFont,
  PDFName,
  PDFNumber,
  PDFPage,
  PDFRawStream,
  PDFStream,
  LineCapStyle,
  LineJoinStyle,
  clip,
  concatTransformationMatrix,
  endPath,
  lineTo,
  moveTo,
  popGraphicsState,
  pushGraphicsState,
  rectangle,
  rgb,
  setLineCap,
  setLineJoin,
  setLineWidth,
  setStrokingRgbColor,
  stroke,
} from 'pdf-lib';

export const MAX_PDF_BYTES = 15 * 1024 * 1024;
export const MAX_PDF_PAGES = 100;
export class PdfInputError extends Error {}

export interface PageInfo {
  width: number;
  height: number;
  rotation: number;
}

export interface FilledField {
  type: 'signature' | 'initials' | 'text' | 'date' | 'checkbox';
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
  value: string | boolean | { strokes: number[][][] };
}

export function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

type Matrix = [number, number, number, number, number, number];
type Layout = PageInfo & { matrix: Matrix };
const invalidPdf =
  'This PDF is incomplete or could not be read. Export a fresh PDF and upload it again.';

function pageLayout(page: PDFPage): Layout {
  const media = page.getMediaBox();
  const crop = page.getCropBox();
  // The visible rectangle is the intersection of the media and crop boxes.
  const left = Math.max(crop.x, media.x);
  const bottom = Math.max(crop.y, media.y);
  const right = Math.min(crop.x + crop.width, media.x + media.width);
  const top = Math.min(crop.y + crop.height, media.y + media.height);
  const rotation = ((page.getRotation().angle % 360) + 360) % 360;
  const unit = page.node.lookupMaybe(PDFName.of('UserUnit'), PDFNumber)?.asNumber() ?? 1;
  if (
    ![left, bottom, right, top, unit].every(Number.isFinite) ||
    right <= left ||
    top <= bottom ||
    unit <= 0
  ) {
    throw new PdfInputError('A page has invalid dimensions. Export a new PDF and try again.');
  }
  const scale = 1 / unit;
  // Map upright, displayed points (bottom-left origin) into the original PDF.
  // The browser uses the same visible region with a top-left origin.
  const transforms: Record<number, Matrix> = {
    0: [scale, 0, 0, scale, left, bottom],
    90: [0, scale, -scale, 0, right, bottom],
    180: [-scale, 0, 0, -scale, right, top],
    270: [0, -scale, scale, 0, left, top],
  };
  const matrix = transforms[rotation];
  if (!matrix)
    throw new PdfInputError(
      'A page has an unsupported rotation. Rotate it to a multiple of 90 degrees.',
    );
  const quarterTurn = rotation === 90 || rotation === 270;
  return {
    width: (quarterTurn ? top - bottom : right - left) * unit,
    height: (quarterTurn ? right - left : top - bottom) * unit,
    rotation,
    matrix,
  };
}

function validatePageContents(doc: PDFDocument, pages: PDFPage[]) {
  const inspected = new Set<PDFStream>();
  let remaining = 64 * 1024 * 1024;
  const tooComplex = 'This PDF is too complex to preview. Export an optimized PDF and try again.';
  for (const page of pages) {
    if (!page.node.has(PDFName.of('Contents'))) continue;
    const contents = page.node.Contents();
    const streams =
      contents instanceof PDFArray
        ? contents.asArray().map((ref) => doc.context.lookup(ref))
        : [contents];
    for (const stream of streams) {
      if (!(stream instanceof PDFStream)) throw new PdfInputError(invalidPdf);
      if (!(stream instanceof PDFRawStream) || inspected.has(stream)) continue;
      inspected.add(stream);
      const filter = stream.dict.lookup(PDFName.of('Filter'));
      const encoding = filter instanceof PDFArray && filter.size() === 1 ? filter.lookup(0) : filter;
      if (encoding !== PDFName.of('FlateDecode') && encoding !== PDFName.of('Fl')) continue;
      // pdf-lib reads stream dictionaries lazily. Check the common page encoding
      // so a broken content stream cannot sit behind a valid trailer.
      try {
        remaining -= inflateSync(stream.getContents(), {
          maxOutputLength: Math.max(1, remaining),
        }).length;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ERR_BUFFER_TOO_LARGE')
          throw new PdfInputError(tooComplex);
        throw new PdfInputError(invalidPdf);
      }
      if (remaining < 0) throw new PdfInputError(tooComplex);
    }
  }
}

async function readDocument(bytes: Buffer) {
  if (bytes.length > MAX_PDF_BYTES) throw new PdfInputError('The PDF exceeds the 15 MiB upload limit.');
  if (!/^%PDF-\d\.\d/.test(bytes.subarray(0, 9).toString('latin1'))) {
    throw new PdfInputError('Choose a PDF document to upload.');
  }
  const trailer = bytes.subarray(Math.max(0, bytes.length - 4096)).toString('latin1');
  const offset = /startxref\s+(\d+)\s+%%EOF[\s\0]*$/.exec(trailer);
  if (!offset) throw new PdfInputError(invalidPdf);
  const start = Number(offset[1]);
  if (!/^(?:xref\b|\d+\s+\d+\s+obj\b)/.test(bytes.subarray(start, start + 64).toString('latin1'))) {
    throw new PdfInputError(invalidPdf);
  }
  try {
    const doc = await PDFDocument.load(bytes, { updateMetadata: false, throwOnInvalidObject: true });
    const count = doc.catalog.Pages().Count().asNumber();
    if (!Number.isInteger(count) || count < 1)
      throw new PdfInputError('The PDF must contain at least one page.');
    if (count > MAX_PDF_PAGES) throw new PdfInputError('Choose a PDF with 100 pages or fewer.');
    const form = doc.catalog.lookupMaybe(PDFName.of('AcroForm'), PDFDict);
    if (form?.has(PDFName.of('XFA'))) {
      throw new PdfInputError(
        'Dynamic XFA forms are unsupported. Export a static PDF and upload it again.',
      );
    }
    for (const [, object] of doc.context.enumerateIndirectObjects()) {
      if (!(object instanceof PDFDict)) continue;
      const signedField =
        object.get(PDFName.of('FT')) === PDFName.of('Sig') && object.has(PDFName.of('V'));
      if (signedField || (object.has(PDFName.of('ByteRange')) && object.has(PDFName.of('Contents')))) {
        throw new PdfInputError(
          'This PDF already contains a digital signature. Upload an unsigned source copy to start a signing request.',
        );
      }
    }
    const pages = doc.getPages();
    if (pages.length !== count) throw new PdfInputError(invalidPdf);
    validatePageContents(doc, pages);
    return { doc, pages, layouts: pages.map(pageLayout) };
  } catch (error) {
    if (error instanceof PdfInputError) throw error;
    if (error instanceof Error && /encrypted/i.test(error.message)) {
      throw new PdfInputError('This PDF is encrypted. Remove its password and upload an unlocked copy.');
    }
    throw new PdfInputError(invalidPdf);
  }
}

export async function inspectPdf(bytes: Buffer): Promise<PageInfo[]> {
  const { layouts } = await readDocument(bytes);
  return layouts.map(({ width, height, rotation }) => ({ width, height, rotation }));
}

type Face = 'Regular' | 'Italic';
const faces = new Map<Face, { bytes: Buffer; supported: Set<number> }>();

function fieldFace(type: FilledField['type']): Face {
  return type === 'signature' || type === 'initials' ? 'Italic' : 'Regular';
}

function getFace(face: Face) {
  let data = faces.get(face);
  if (!data) {
    const bytes = readFileSync(join(__dirname, '../assets', `LiberationSans-${face}.ttf`));
    const font = fontkit.create(bytes);
    if (!('characterSet' in font))
      throw new Error('A bundled signing font must contain a single typeface.');
    data = { bytes, supported: new Set(font.characterSet) };
    faces.set(face, data);
  }
  return data;
}

export async function embedBodyFont(doc: PDFDocument) {
  doc.registerFontkit(fontkit);
  return doc.embedFont(getFace('Regular').bytes, { subset: true });
}

export function validatePdfText(value: string, type: FilledField['type']): void {
  const text = value.normalize('NFC').replace(/\r\n?/g, '\n');
  const font = getFace(fieldFace(type));
  for (const char of text) {
    if (char === '\n' && type === 'text') continue;
    if (!font.supported.has(char.codePointAt(0)!) || /[\p{Cc}\p{Cf}]/u.test(char)) {
      const remedy =
        fieldFace(type) === 'Italic'
          ? 'Use a different character or draw your signature.'
          : 'Use a different character.';
      throw new PdfInputError('A character cannot be printed in this field. ' + remedy);
    }
  }
}

const ink = rgb(0.09, 0.14, 0.13);

function drawText(
  page: PDFPage,
  field: FilledField,
  value: string,
  font: PDFFont,
  width: number,
  height: number,
) {
  const lines = value.normalize('NFC').replace(/\r\n?/g, '\n').split('\n');
  const margin = Math.min(2, width * 0.05, height * 0.08);
  const widest = Math.max(...lines.map((line) => font.widthOfTextAtSize(line, 1)), 0.01);
  const lineHeight = font.heightAtSize(1);
  const leading = lineHeight * 1.15;
  const block = lineHeight + (lines.length - 1) * leading;
  const size = Math.min(
    field.type === 'signature' ? 30 : 18,
    (width - 2 * margin) / widest,
    (height - 2 * margin) / block,
  );
  const ascent = font.heightAtSize(size, { descender: false });
  let baseline = (height + block * size) / 2 - ascent;
  for (const line of lines) {
    if (line.length) page.drawText(line, { font, size, x: margin, y: baseline, color: ink });
    baseline -= leading * size;
  }
}

function drawCheckbox(page: PDFPage, checked: boolean, width: number, height: number) {
  const side = Math.min(width, height, 26) * 0.78;
  const x = (width - side) / 2;
  const y = (height - side) / 2;
  page.drawRectangle({ x, y, width: side, height: side, borderWidth: side / 14, borderColor: ink });
  if (checked) {
    page.pushOperators(
      setStrokingRgbColor(ink.red, ink.green, ink.blue),
      setLineWidth(side / 9),
      setLineJoin(LineJoinStyle.Round),
      setLineCap(LineCapStyle.Round),
      moveTo(x + side * 0.19, y + side * 0.51),
      lineTo(x + side * 0.41, y + side * 0.27),
      lineTo(x + side * 0.82, y + side * 0.76),
      stroke(),
    );
  }
}

export function validatePdfStrokes(strokes: number[][][]): void {
  if (!Array.isArray(strokes) || !strokes.length || strokes.length > 256) {
    throw new PdfInputError('Draw a signature before continuing.');
  }
  let count = 0;
  for (const points of strokes) {
    if (!Array.isArray(points) || !points.length)
      throw new PdfInputError('The drawn signature is incomplete.');
    count += points.length;
    if (count > 12000)
      throw new PdfInputError('The drawing is too detailed. Clear it and draw a shorter signature.');
    for (const point of points) {
      if (
        !Array.isArray(point) ||
        point.length !== 2 ||
        !point.every((n) => Number.isFinite(n) && n >= 0 && n <= 1)
      ) {
        throw new PdfInputError(
          'The signature contains a point outside its field. Clear it and try again.',
        );
      }
    }
  }
}

function drawStrokes(page: PDFPage, strokes: number[][][], width: number, height: number) {
  validatePdfStrokes(strokes);
  const thickness = Math.min(2.3, width * 0.025, height * 0.055);
  const x = (n: number) => thickness / 2 + n * (width - thickness);
  const y = (n: number) => height - thickness / 2 - n * (height - thickness);
  page.pushOperators(
    setStrokingRgbColor(ink.red, ink.green, ink.blue),
    setLineWidth(thickness),
    setLineCap(LineCapStyle.Round),
    setLineJoin(LineJoinStyle.Round),
  );
  for (const points of strokes) {
    const first = points[0];
    if (points.length === 1) {
      page.drawCircle({ x: x(first[0]), y: y(first[1]), size: thickness / 2, color: ink });
    } else {
      page.pushOperators(moveTo(x(first[0]), y(first[1])));
      for (const [px, py] of points.slice(1)) page.pushOperators(lineTo(x(px), y(py)));
      page.pushOperators(stroke());
    }
  }
}

export async function completePdf(original: Buffer, fields: FilledField[]): Promise<Buffer> {
  const { doc, pages, layouts } = await readDocument(original);
  doc.registerFontkit(fontkit);
  const fonts = new Map<Face, PDFFont>();
  for (const field of fields) {
    const layout = layouts[field.page];
    if (
      !Number.isInteger(field.page) ||
      !layout ||
      ![field.x, field.y, field.w, field.h].every(Number.isFinite) ||
      field.x < 0 ||
      field.y < 0 ||
      field.w <= 0 ||
      field.h <= 0 ||
      field.x + field.w > 1.000001 ||
      field.y + field.h > 1.000001
    ) {
      throw new PdfInputError('A field extends outside its document page.');
    }
    const page = pages[field.page];
    const width = field.w * layout.width;
    const height = field.h * layout.height;
    const left = field.x * layout.width;
    const bottom = (1 - field.y - field.h) * layout.height;
    page.pushOperators(
      pushGraphicsState(),
      concatTransformationMatrix(...layout.matrix),
      concatTransformationMatrix(1, 0, 0, 1, left, bottom),
      rectangle(0, 0, width, height),
      clip(),
      endPath(),
    );
    if (field.type === 'checkbox' && typeof field.value === 'boolean') {
      drawCheckbox(page, field.value, width, height);
    } else if (field.type !== 'checkbox' && typeof field.value === 'string') {
      validatePdfText(field.value, field.type);
      const face = fieldFace(field.type);
      let font = fonts.get(face);
      if (!font) {
        font = await doc.embedFont(getFace(face).bytes, { subset: true });
        fonts.set(face, font);
      }
      drawText(page, field, field.value, font, width, height);
    } else if (
      (field.type === 'signature' || field.type === 'initials') &&
      typeof field.value === 'object' &&
      field.value
    ) {
      drawStrokes(page, field.value.strokes, width, height);
    } else {
      throw new PdfInputError('The value does not match its document field.');
    }
    page.pushOperators(popGraphicsState());
  }
  doc.setProducer('LumoDossier');
  return Buffer.from(await doc.save({ updateFieldAppearances: false, addDefaultPage: false }));
}
