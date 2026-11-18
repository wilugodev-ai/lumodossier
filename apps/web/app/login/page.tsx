import { Suspense } from 'react';
import { Brand } from '../../components/Brand';
import { AuthForm } from '../../components/AuthForm';
import { SceneArt, MotionControl } from '../../components/Motion';
export const metadata = { title: 'Your account' };
export default function Login() {
  return (
    <main id="main" className="auth-layout">
      <div className="auth-main">
        <Brand />
        <Suspense fallback={<p>Opening your account…</p>}>
          <AuthForm />
        </Suspense>
      </div>
      <aside className="auth-volume">
        <div className="auth-scene" aria-hidden="true">
          <SceneArt />
        </div>
        <div className="auth-caption">
          <h2>Sign with intent.</h2>
          <p>Private documents. Explicit consent. A record you can keep.</p>
        </div>
        <MotionControl />
      </aside>
    </main>
  );
}
