export type Kind = 'signature' | 'initials' | 'date' | 'text' | 'checkbox';
export type Person = { id: string; name: string; email: string; signingRole?: string };
export type Field = {
  id: string;
  personId: string;
  type: Kind;
  label: string;
  required: boolean;
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
};
export type PageInfo = { width: number; height: number; rotation: number };
export type Refs = { customer?: string; quote?: string; deal?: string };
export type Value = string | boolean | { strokes: number[][][] };
export type Workspace = {
  id: string;
  name: string;
  role: 'owner' | 'member' | 'viewer';
  source: 'standalone' | 'touchlumo';
};
export type Draft = {
  title: string;
  routing: 'sequential' | 'simultaneous';
  recipients: Person[];
  fields: Field[];
  crm: Refs;
};
export type Summary = Draft & {
  id: string;
  status: string;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  signed: number;
  total: number;
};
export type Detail = Summary & {
  workspace_id: string;
  revision: number;
  version_id: string;
  pages: PageInfo[];
  sender_name: string;
  sender_email: string;
  expires_at: string | null;
  sealed_at: string | null;
  emailEnabled: boolean;
  processingFailed: boolean;
  people: (Person & {
    ordinal: number;
    viewed_at: string | null;
    signed_at: string | null;
    declined_at: string | null;
  })[];
  events: {
    id: string;
    kind: string;
    actor: string;
    occurred_at: string;
    detail: { reason?: string };
  }[];
  deliveries: {
    id: string;
    kind: string;
    status: string;
    person_id: string | null;
    attempts: number;
    attempt_log: { outcome: string; at: string }[];
    created_at: string;
  }[];
};
export type SigningView = {
  requestId: string;
  title: string;
  senderName: string;
  senderEmail: string;
  recipient: Person;
  pages: PageInfo[];
  fields: Field[];
  signed: boolean;
  completed: boolean;
  signedAt: string | null;
  completedAt: string | null;
  consentVersion: string;
  consent: string;
  intent: string;
  expiresAt: string;
};
export const fieldNames: Record<Kind, string> = {
  signature: 'Signature',
  initials: 'Initials',
  date: 'Date',
  text: 'Text',
  checkbox: 'Checkbox',
};
export const states: Record<string, string> = {
  draft: 'Draft',
  sent: 'Sent',
  viewed: 'Viewed',
  partially_signed: 'Partially signed',
  completed: 'Completed',
  declined: 'Declined',
  expired: 'Expired',
  cancelled: 'Cancelled',
};
