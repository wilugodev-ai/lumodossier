import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PDFDocument, type PDFFont, breakTextIntoLines, rgb } from 'pdf-lib';
import { z } from 'zod';
import { ensure, Problem, type Field, type Person } from './model';
import { embedBodyFont, validatePdfText } from './pdf';

type Box = [number, number, number, number];
type DetailInput = {
  key: string;
  label: string;
  hint?: string;
  options?: string[];
  limit?: number;
  required?: boolean;
};
type PropertyTemplate = {
  id: string;
  title: string;
  description: string;
  dateLabel: string;
  roles: string[];
  details: DetailInput[];
};
const directory = join(__dirname, '../assets/real-estate');
const catalog: {
  page: [number, number];
  layout: { address: Box; eventDate: Box; rows: Box[]; signature: Box[]; signedDate: Box[] };
  templates: PropertyTemplate[];
} = JSON.parse(readFileSync(join(directory, 'catalog.json'), 'utf8'));

export const propertyTemplates = catalog.templates.map(
  ({ id, title, description, roles, dateLabel, details }) => ({
    id,
    title,
    description,
    roles,
    inputs: [
      {
        key: 'address',
        label: 'Property address / unit',
        hint: 'Street address, unit, and city',
        limit: 160,
        required: true,
      },
      { key: 'eventDate', label: dateLabel, type: 'date', required: true },
      ...details,
    ] as (DetailInput & { type?: 'date' })[],
  }),
);

function fitText(value: string, font: PDFFont, width: number, height: number, label: string) {
  for (let size = 12; size >= 9; size--) {
    const measure = (s: string) => font.widthOfTextAtSize(s, size);
    const lines = breakTextIntoLines(value, [' ', '-'], width, measure).flatMap((line) =>
      measure(line) <= width ? [line] : breakTextIntoLines(line, [''], width, measure),
    );
    if (lines.length * size * 1.28 <= height) return { lines, size };
  }
  throw new Problem(400, 'Shorten the text for ' + label + ' so it fits on the form.');
}

export async function preparePropertyTemplate(
  templateId: string,
  input: Record<string, string>,
  contact?: Person,
) {
  const form = propertyTemplates.find((item) => item.id === templateId);
  ensure(form, 404, 'Real estate template not found.');
  ensure(
    Object.keys(input).every((key) => form.inputs.some((field) => field.key === key)),
    400,
    'An entry does not belong to this template.',
  );

  const boxes = [catalog.layout.address, catalog.layout.eventDate, ...catalog.layout.rows];
  const pdf = await PDFDocument.load(await readFile(join(directory, form.id + '.pdf')));
  const page = pdf.getPage(0);
  const font = await embedBodyFont(pdf);
  const ink = rgb(0.08, 0.14, 0.15);
  for (const [index, field] of form.inputs.entries()) {
    const raw = input[field.key] ?? '';
    const value = raw.trim().normalize('NFC').replace(/\r\n?/g, '\n');
    ensure(!field.required || value, 400, 'Enter ' + field.label.toLowerCase() + '.');
    if (!value) continue;
    ensure(value.length <= (field.limit ?? 60), 400, field.label + ' is too long.');
    if (field.options)
      ensure(field.options.includes(value), 400, 'Choose a listed option for ' + field.label + '.');
    if (field.type === 'date')
      ensure(z.iso.date().safeParse(value).success, 400, 'Enter a valid calendar date.');
    validatePdfText(value, 'text');
    const [left, top, width, height] = boxes[index];
    const { lines, size } = fitText(value, font, width - 8, height - 6, field.label);
    const leading = size * 1.28;
    const y = page.getHeight() - top - (height - lines.length * leading) / 2 - size;
    page.drawText(lines.join('\n'), { x: left + 3, y, size, lineHeight: leading, font, color: ink });
  }
  const recipients: Person[] = form.roles.map((role, index) => ({
    ...(index === 0 && contact ? contact : { id: randomUUID(), name: '', email: '' }),
    signingRole: role,
  }));
  const fields: Field[] = recipients.flatMap((person, index) =>
    (['signature', 'date'] as const).map((type) => {
      const [x, y, w, h] = (type === 'signature' ? catalog.layout.signature : catalog.layout.signedDate)[
        index
      ];
      return {
        id: randomUUID(),
        personId: person.id,
        type,
        page: 0,
        required: true,
        label: form.roles[index] + (type === 'signature' ? ' signature' : ' signing date'),
        x: x / page.getWidth(),
        y: y / page.getHeight(),
        w: w / page.getWidth(),
        h: h / page.getHeight(),
      };
    }),
  );
  const address = input.address.trim().replace(/\s+/g, ' ');
  const title = (form.title + ' - ' + address).slice(0, 160);
  return { title, data: Buffer.from(await pdf.save()), recipients, fields };
}
