import { Suspense } from 'react';
import { Dashboard } from '../../components/Dashboard';
export const metadata = { title: 'Document workspace', robots: { index: false, follow: false } };
export default function Page() {
  return (
    <Suspense
      fallback={
        <main id="main" className="loading-screen">
          Opening your workspace…
        </main>
      }
    >
      <Dashboard />
    </Suspense>
  );
}
