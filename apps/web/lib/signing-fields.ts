import type { Field, Value } from './types';

export function completedField(field: Field, value?: Value) {
  if (field.type === 'checkbox') return value === true;
  if (value && typeof value === 'object') {
    return value.strokes.some((stroke) =>
      stroke.some((p) => Math.hypot(p[0] - stroke[0][0], p[1] - stroke[0][1]) > 0.012),
    );
  }
  if (typeof value !== 'string' || !value.trim()) return false;
  if (field.type !== 'date') return true;
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value
  );
}
