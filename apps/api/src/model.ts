import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import type { PageInfo, FilledField } from './pdf';
import { validatePdfText } from './pdf';

export class Problem extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export function ensure(condition: unknown, status: number, message: string): asserts condition {
  if (!condition) throw new Problem(status, message);
}
export const id = z.uuid();
export const crmSchema = z.strictObject({
  customer: id.optional(),
  quote: id.optional(),
  deal: id.optional(),
});
export type Refs = z.infer<typeof crmSchema>;
export const personSchema = z.strictObject({
  id,
  name: z.string().trim().min(1).max(120),
  email: z
    .email()
    .max(254)
    .transform((s) => s.toLowerCase()),
});
const unit = z.number().min(0).max(1);
export const fieldSchema = z.strictObject({
  id,
  personId: id,
  type: z.enum(['signature', 'initials', 'text', 'date', 'checkbox']),
  page: z.number().int().min(0).max(99),
  x: unit,
  y: unit,
  w: z.number().min(0.012).max(1),
  h: z.number().min(0.008).max(1),
  required: z.boolean(),
  label: z.string().trim().min(1).max(90),
});
export const draftSchema = z.strictObject({
  revision: z.number().int().positive(),
  title: z.string().trim().min(1).max(160),
  routing: z.enum(['sequential', 'simultaneous']),
  recipients: z
    .array(
      z.strictObject({
        id,
        name: z.string().trim().max(120),
        email: z
          .string()
          .trim()
          .max(254)
          .transform((v) => v.toLowerCase()),
      }),
    )
    .max(30),
  fields: z.array(fieldSchema).max(400),
  crm: crmSchema.default({}),
});
export type Person = z.infer<typeof personSchema>;
export type Field = z.infer<typeof fieldSchema>;
export type Draft = Omit<z.infer<typeof draftSchema>, 'revision'>;
export type Identity = { id: string; email: string; name: string; token: string };
export type Space = {
  id: string;
  name: string;
  role: 'owner' | 'member' | 'viewer';
  source: 'standalone' | 'touchlumo';
};
export type DocumentRow = Draft & {
  id: string;
  workspace_id: string;
  version_id: string;
  sender_id: string;
  sender_email: string;
  sender_name: string;
  original_hash: string;
  completed_hash: string | null;
  pages: PageInfo[];
  revision: number;
  created_at: Date;
  updated_at: Date;
  sent_at: Date | null;
  expires_at: Date | null;
  sealed_at: Date | null;
  completed_at: Date | null;
  cancelled_at: Date | null;
  expired_at: Date | null;
  declined_at: Date | null;
};
export type Progress = Person & {
  ordinal: number;
  viewed_at: Date | null;
  signed_at: Date | null;
  declined_at: Date | null;
};
export const CONSENT_VERSION = '2026-11-18.1';
export const CONSENT =
  'I consent to use electronic records and signatures for this document and to receive an electronic copy.';
export const INTENT = 'I have reviewed this document and intend to sign it electronically.';
export const METHOD = 'Possession of a private recipient link';
export function validateDraft(d: Draft, pages: PageInfo[], sending = false) {
  const people = new Set(d.recipients.map((p) => p.id));
  const addresses = d.recipients.map((p) => p.email.toLowerCase()).filter(Boolean);
  ensure(
    people.size === d.recipients.length && new Set(addresses).size === addresses.length,
    400,
    'Each recipient needs a unique email address.',
  );
  ensure(new Set(d.fields.map((f) => f.id)).size === d.fields.length, 400, 'Duplicate document field.');
  for (const f of d.fields) {
    ensure(people.has(f.personId), 400, 'Assign each field to a recipient.');
    ensure(
      f.page < pages.length && f.x + f.w <= 1.000001 && f.y + f.h <= 1.000001,
      400,
      'Place every field inside its page.',
    );
  }
  if (sending) {
    ensure(people.size > 0, 400, 'Add at least one recipient.');
    for (const p of d.recipients) {
      ensure(
        personSchema.safeParse(p).success,
        400,
        'Every recipient needs a name and valid email address.',
      );
      ensure(
        d.fields.some(
          (f) => f.personId === p.id && f.required && ['signature', 'initials'].includes(f.type),
        ),
        400,
        'Place a required signature or initials field for ' + p.name + '.',
      );
    }
  }
}
export const signSchema = z.strictObject({
  consent: z.literal(true),
  intent: z.literal(true),
  consentVersion: z.literal(CONSENT_VERSION),
  values: z.record(z.string(), z.unknown()),
});
export type Value = FilledField['value'];
const drawing = z.strictObject({
  strokes: z
    .array(
      z
        .array(z.tuple([unit, unit]))
        .min(2)
        .max(1000),
    )
    .min(1)
    .max(50),
});
export function checkedValues(fields: Field[], input: Record<string, unknown>): Record<string, Value> {
  ensure(
    Object.keys(input).every((key) => fields.some((f) => f.id === key)),
    403,
    'A field belongs to a different recipient.',
  );
  const out: Record<string, Value> = {};
  for (const f of fields) {
    const v = input[f.id];
    const blankDrawing =
      (f.type === 'signature' || f.type === 'initials') &&
      typeof v === 'object' &&
      v !== null &&
      'strokes' in v &&
      Array.isArray(v.strokes) &&
      v.strokes.length === 0;
    if (
      v === undefined ||
      v === null ||
      blankDrawing ||
      (typeof v === 'string' && !v.trim()) ||
      (f.type === 'checkbox' && v === false)
    ) {
      ensure(!f.required, 400, 'Complete the required field "' + f.label + '".');
      continue;
    }
    if (f.type === 'checkbox') {
      ensure(v === true, 400, 'Choose a checkbox value.');
      out[f.id] = true;
      continue;
    }
    if (typeof v === 'object' && (f.type === 'signature' || f.type === 'initials')) {
      const result = drawing.safeParse(v);
      ensure(
        result.success &&
          result.data.strokes.flat().length <= 6000 &&
          result.data.strokes.some((s) =>
            s.some((p) => Math.hypot(p[0] - s[0][0], p[1] - s[0][1]) > 0.012),
          ),
        400,
        'Draw a visible signature inside the box.',
      );
      out[f.id] = result.data;
      continue;
    }
    ensure(
      typeof v === 'string' && v.trim().length <= 200 && !/[\x00-\x1f\x7f]/u.test(v),
      400,
      'Enter a single line of up to 200 characters.',
    );
    const value = v.trim();
    if (f.type === 'date') {
      ensure(
        /^\d{4}-\d{2}-\d{2}$/.test(value) &&
          Number.isFinite(Date.parse(value)) &&
          new Date(value).toISOString().slice(0, 10) === value,
        400,
        'Enter a valid date.',
      );
    }
    validatePdfText(value, f.type);
    out[f.id] = value;
  }
  return out;
}
export function personFromContact(name: string, email: string) {
  return { id: randomUUID(), name, email };
}
