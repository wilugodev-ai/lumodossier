'use client';
import { useId, useState } from 'react';
import { Fingerprint } from 'lucide-react';
import { access, message, request } from '../lib/client';

export function VerifyCopy({
  recordPath,
  requestId,
  recipientToken,
}: {
  recordPath: string;
  requestId: string;
  recipientToken?: string;
}) {
  const id = useId();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ text: string; success?: boolean } | null>(null);

  async function compare(file: File) {
    setBusy(true);
    setResult(null);
    try {
      const response = await request(recordPath, recipientToken ?? (await access()));
      const record = await response.json();
      if (record.requestId !== requestId || !/^[a-f0-9]{64}$/i.test(record.completedSha256)) {
        throw new Error('The completion record could not be verified. Try again.');
      }
      const bytes = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
      const digest = Array.from(new Uint8Array(bytes), (byte) =>
        byte.toString(16).padStart(2, '0'),
      ).join('');
      const matches = digest === record.completedSha256.toLowerCase();
      setResult({
        success: matches,
        text: matches
          ? 'Exact match. This PDF is identical to the signed copy in the completion record.'
          : 'Different file. This PDF does not match the signed copy in the completion record.',
      });
    } catch (e) {
      setResult({ text: message(e) });
    } finally {
      setBusy(false);
    }
  }
  return (
    <details className="verify-copy">
      <summary>
        <Fingerprint size={17} aria-hidden="true" /> Verify a signed copy
      </summary>
      <p>
        Choose a PDF to compare with this agreement’s completion record. Your file stays on this device.
      </p>
      <label htmlFor={id}>Choose a signed PDF</label>
      <input
        id={id}
        type="file"
        accept="application/pdf,.pdf"
        disabled={busy}
        onChange={(e) => {
          const file = e.currentTarget.files?.[0];
          e.currentTarget.value = '';
          if (file) void compare(file);
        }}
      />
      <div aria-live="polite">
        {busy && <p>Checking your file…</p>}
        {result && <p className={'notice ' + (result.success ? '' : 'warning')}>{result.text}</p>}
      </div>
    </details>
  );
}
