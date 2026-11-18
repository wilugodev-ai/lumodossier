import { Suspense } from 'react';
import { Brand } from '../components/Brand';
import { HomeAccount } from '../components/HomeAccount';
import { HomeActions } from '../components/HomeActions';
import { SceneArt, MotionControl } from '../components/Motion';

export default function Home() {
  return (
    <div className="landing">
      <header className="site-header">
        <div className="container nav-inner">
          <Brand />
          <MotionControl />
        </div>
      </header>
      <main id="main" className="container home-content">
        <div className="home-copy">
          <div className="eyebrow">
            <span className="eyeline" />
            Electronic signatures
          </div>
          <h1>
            Sign. Send.
            <br />
            Keep everything
            <br />
            <em>moving.</em>
          </h1>
          <p>Send private signing links, record consent, and track agreements here or in Touchlumo.</p>
          <HomeActions />
        </div>
      </main>
      <div className="home-art" aria-hidden="true">
        <SceneArt />
      </div>
      <Suspense>
        <HomeAccount />
      </Suspense>
    </div>
  );
}
