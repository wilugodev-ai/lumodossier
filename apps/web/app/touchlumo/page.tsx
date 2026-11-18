import { Suspense } from 'react';
import { Brand } from '../../components/Brand';
import { ConnectedView } from '../../integrations/ConnectedView';
export const metadata = { title: 'Touchlumo documents', robots: { index: false, follow: false } };
export default function Page() {
  return (
    <>
      <header className="site-header">
        <div className="container nav-inner">
          <Brand />
          <span>Touchlumo</span>
        </div>
      </header>
      <main id="main" className="container signing">
        <Suspense fallback={<p>Opening connected workspace…</p>}>
          <ConnectedView />
        </Suspense>
      </main>
    </>
  );
}
