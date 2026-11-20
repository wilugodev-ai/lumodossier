import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PDFDocument, type PDFFont, type PDFPage, breakTextIntoLines, rgb } from 'pdf-lib';
import { z } from 'zod';
import { ensure, Problem, type Field, type Person } from './model';
import { embedBodyFont, validatePdfText } from './pdf';

type Box = [number, number, number, number];
type SlotKind = 'text' | 'signature' | 'date';
type Slots = Partial<Record<SlotKind, Box>>;
type Input = {
  key: string;
  label: string;
  hint?: string;
  options?: string[];
  limit?: number;
  required?: boolean;
  type?: 'text' | 'date' | 'money' | 'fee' | 'days';
};
type PrintInput = Input & { box: Box };
type Signer = { role: string; nameKey?: string; when?: string };
type Form = {
  id: string;
  title: string;
  description: string;
  group: string;
  guidance?: string;
  inputs: PrintInput[];
  signers: Signer[];
  slots: Slots[];
  signingPage: number;
  titleKey: string;
  agreement?: 'listing' | 'referral';
};
const directory = join(__dirname, '../assets/real-estate');
const records: {
  layout: { address: Box; eventDate: Box; rows: Box[]; signature: Box[]; signedDate: Box[] };
  templates: {
    id: string;
    title: string;
    description: string;
    dateLabel: string;
    roles: string[];
    details: Input[];
  }[];
} = JSON.parse(readFileSync(join(directory, 'catalog.json'), 'utf8'));
type Kind = 'sale' | 'rental' | 'referral';
const florida: {
  templates: { id: string; title: string; description: string; kind: Kind }[];
  specs: Record<Kind, { inputs: PrintInput[]; signers: Signer[] }>;
  signaturePage: number;
  signatureSlots: Slots[];
} = JSON.parse(readFileSync(join(directory, 'florida.json'), 'utf8'));

const guidance: Record<Kind, string> = {
  sale: 'Florida residential sale under transaction brokerage. Enter each owner and the fee negotiated for this property.',
  rental:
    'Florida residential tenant placement. Choose the rental appointment and enter the negotiated fee.',
  referral:
    'Licensed real estate brokerages sign this agreement. Confirm the client’s permission before sharing contact details.',
};
const forms: Form[] = [
  ...florida.templates.map(({ id, title, description, kind }): Form => ({
    id,
    title,
    description,
    group: kind === 'referral' ? 'Florida broker referrals' : 'Florida listing agreements',
    guidance: guidance[kind],
    ...florida.specs[kind],
    slots: florida.signatureSlots,
    signingPage: florida.signaturePage,
    titleKey: kind === 'referral' ? 'client' : 'address',
    agreement: kind === 'referral' ? 'referral' : 'listing',
  })),
  ...records.templates.map(({ id, title, description, dateLabel, roles, details }): Form => ({
    id,
    title,
    description,
    group: 'Property records',
    titleKey: 'address',
    signingPage: 0,
    inputs: [
      {
        key: 'address',
        label: 'Property address / unit',
        hint: 'Street address, unit, and city',
        limit: 160,
        required: true,
        box: records.layout.address,
      },
      {
        key: 'eventDate',
        label: dateLabel,
        type: 'date',
        required: true,
        box: records.layout.eventDate,
      },
      ...details.map((d, i) => ({ ...d, box: records.layout.rows[i] })),
    ],
    signers: roles.map((role) => ({ role })),
    slots: roles.map((_, i) => ({
      signature: records.layout.signature[i],
      date: records.layout.signedDate[i],
    })),
  })),
];

export const propertyTemplates = forms.map(
  ({ id, title, description, group, guidance, signers, inputs }) => ({
    id,
    title,
    description,
    group,
    guidance,
    roles: signers.filter((s) => !s.when).map((s) => s.role),
    inputs: inputs.map(({ key, label, hint, options, limit, required, type }) => ({
      key,
      label,
      hint,
      options,
      limit,
      required,
      type,
    })),
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
function print(page: PDFPage, font: PDFFont, box: Box, value: string, label: string) {
  const [left, top, width, height] = box;
  const { lines, size } = fitText(value, font, width - 8, height - 6, label);
  const leading = size * 1.28;
  const y = page.getHeight() - top - (height - lines.length * leading) / 2 - size;
  page.drawText(lines.join('\n'), {
    x: left + 3,
    y,
    size,
    lineHeight: leading,
    font,
    color: rgb(0.08, 0.14, 0.15),
  });
}
const dollars = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
function printedValue(field: Input, raw: string, feeBasis: string) {
  const value = raw.trim().normalize('NFC').replace(/\r\n?/g, '\n');
  ensure(!field.required || value, 400, 'Enter ' + field.label.toLowerCase() + '.');
  if (!value) return '';
  ensure(value.length <= (field.limit ?? 60), 400, field.label + ' is too long.');
  if (field.options)
    ensure(field.options.includes(value), 400, 'Choose a listed option for ' + field.label + '.');
  if (field.type === 'date')
    ensure(z.iso.date().safeParse(value).success, 400, 'Enter a valid calendar date.');
  if (field.type === 'days')
    ensure(/^\d{1,4}$/.test(value), 400, 'Enter a whole number of calendar days.');
  if (field.type === 'fee' && feeBasis !== 'Flat fee in USD') {
    const rate = value.replace(/%$/, '').trim();
    ensure(
      /^\d{1,7}(?:\.\d{1,4})?$/.test(rate),
      400,
      'Enter the negotiated percentage as a nonnegative number.',
    );
    return Number(rate) + '%';
  }
  if (field.type === 'money' || field.type === 'fee') {
    const amount = value.replace(/^\$/, '').trim();
    ensure(
      /^(?:\d{1,12}|\d{1,3}(?:,\d{3}){1,3})(?:\.\d{1,2})?$/.test(amount),
      400,
      'Enter a USD amount with up to two decimal places for ' + field.label + '.',
    );
    const number = Number(amount.replaceAll(',', ''));
    ensure(
      field.type !== 'money' || number > 0,
      400,
      'Enter an asking price or rent greater than zero.',
    );
    return dollars.format(number);
  }
  validatePdfText(value, 'text');
  return value;
}

export async function preparePropertyTemplate(
  templateId: string,
  input: Record<string, string>,
  contact?: Person,
) {
  const form = forms.find((item) => item.id === templateId);
  ensure(form, 404, 'Real estate template not found.');
  ensure(
    Object.keys(input).every((key) => form.inputs.some((field) => field.key === key)),
    400,
    'An entry does not belong to this template.',
  );
  const values = Object.fromEntries(
    form.inputs.map((field) => [
      field.key,
      printedValue(field, input[field.key] ?? '', input.feeBasis?.trim() ?? ''),
    ]),
  );
  if (form.agreement)
    ensure(
      values.endDate >= values.startDate,
      400,
      'Choose an expiration date on or after the start date.',
    );
  const pdf = await PDFDocument.load(await readFile(join(directory, form.id + '.pdf')));
  const page = pdf.getPage(0),
    signingPage = pdf.getPage(form.signingPage);
  const font = await embedBodyFont(pdf);
  for (const field of form.inputs) {
    if (values[field.key]) print(page, font, field.box, values[field.key], field.label);
  }
  const recipients: Person[] = [];
  const fields: Field[] = [];
  for (const [index, signer] of form.signers.entries()) {
    const slots = form.slots[index];
    if (signer.when && !values[signer.when]) {
      if (slots.signature)
        print(signingPage, font, slots.signature, 'No second owner named', signer.role);
      continue;
    }
    const name = signer.nameKey ? values[signer.nameKey] : '';
    const matchingOwner =
      signer.nameKey === 'owner' && name.toLowerCase() === contact?.name.trim().toLowerCase();
    const useContact = contact && ((!form.agreement && index === 0) || matchingOwner);
    const person = {
      id: randomUUID(),
      signingRole: signer.role,
      name: name || (useContact ? contact.name : ''),
      email: useContact ? contact.email : '',
    };
    recipients.push(person);
    for (const [type, box] of Object.entries(slots) as [SlotKind, Box][]) {
      const [x, y, w, h] = box;
      const label = { text: ' printed name', signature: ' signature', date: ' signing date' }[type];
      fields.push({
        id: randomUUID(),
        personId: person.id,
        type,
        page: form.signingPage,
        required: true,
        label: signer.role + label,
        x: x / signingPage.getWidth(),
        y: y / signingPage.getHeight(),
        w: w / signingPage.getWidth(),
        h: h / signingPage.getHeight(),
      });
    }
  }
  const title = (form.title + ' - ' + values[form.titleKey].replace(/\s+/g, ' ')).slice(0, 160);
  const agreement = form.agreement
    ? { kind: form.agreement, signers: recipients.map((p) => p.id), fields: fields.map((f) => f.id) }
    : undefined;
  return { title, data: Buffer.from(await pdf.save()), recipients, fields, agreement };
}
