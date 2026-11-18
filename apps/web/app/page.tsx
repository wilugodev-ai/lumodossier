import Link from 'next/link';
import {
  Signature,
  LockKeyhole,
  Fingerprint,
  History,
  FileUp,
  ScanLine,
  Send,
  Files,
  Network,
  ShieldCheck,
  Timer,
  ListChecks,
} from 'lucide-react';
import { Brand } from '../components/Brand';
import { SceneArt, MotionControl } from '../components/Motion';
const phases = [
  {
    Icon: FileUp,
    title: 'Prepare your document',
    body: 'Upload a PDF and choose who needs to sign. Save a draft and pick up where you left off.',
  },
  {
    Icon: ScanLine,
    title: 'Place the fields',
    body: 'Add signatures, initials, dates and other fields directly on the page. Assign each one to its recipient.',
  },
  {
    Icon: Send,
    title: 'Send and follow along',
    body: 'Invite people together or in sequence. See who has viewed, signed or declined.',
  },
  {
    Icon: Files,
    title: 'Keep the signed copy',
    body: 'Download the completed PDF and a record of the recipients, consent and signing history.',
  },
];
export default function Home() {
  return (
    <div className="landing">
      <header className="site-header">
        <div className="container nav-inner">
          <Brand />
          <nav aria-label="Main navigation">
            <a href="#workflow">Workflow</a>
            <a href="#protection">Security</a>
            <a href="#touchlumo">Touchlumo</a>
          </nav>
          <div className="nav-actions">
            <Link className="text-link" href="/login">
              Sign in
            </Link>
            <Link className="button small-btn" href="/login?mode=signup">
              Get started
            </Link>
          </div>
        </div>
      </header>
      <main id="main">
        <section className="immersive-hero">
          <div className="hero-volume" aria-hidden="true">
            <SceneArt />
          </div>
          <div className="container hero-stage">
            <div className="hero-copy">
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
              <p>
                Prepare agreements, collect signatures and keep a clear record of consent in one private
                workspace.
              </p>
              <div className="hero-actions">
                <Link className="button" href="/login?mode=signup">
                  <Signature size={19} />
                  Create a workspace
                </Link>
                <a className="button outline" href="#workflow">
                  Explore the workflow
                </a>
              </div>
            </div>
          </div>
          <div className="hero-control">
            <MotionControl />
          </div>
        </section>
        <div className="benefit-band">
          <div className="container benefits">
            <div>
              <LockKeyhole />
              <span>Private document storage</span>
            </div>
            <div>
              <Timer />
              <span>Expiring recipient links</span>
            </div>
            <div>
              <History />
              <span>Recorded signing history</span>
            </div>
          </div>
        </div>
        <section id="workflow" className="container workflow">
          <div className="section-head">
            <div>
              <div className="eyebrow">
                <span className="eyeline" />
                The workflow
              </div>
              <h2>
                From draft to <em>done.</em>
              </h2>
            </div>
            <p>One place for the document, its recipients and every step in between.</p>
          </div>
          <div className="phase-grid">
            {phases.map(({ Icon, title, body }) => (
              <article key={title}>
                <Icon size={26} />
                <h3>{title}</h3>
                <p>{body}</p>
              </article>
            ))}
          </div>
        </section>
        <section id="protection" className="security-section">
          <div className="container security-grid">
            <div>
              <div className="eyebrow">
                <ShieldCheck size={16} />
                Document security
              </div>
              <h2>
                A clear record of
                <br />
                <em>what you signed.</em>
              </h2>
              <p>
                You can read the agreement, check the sender and choose to sign or decline before
                anything is recorded.
              </p>
            </div>
            <div className="security-list">
              <article>
                <LockKeyhole />
                <div>
                  <h3>Access through a private link</h3>
                  <p>
                    Each recipient gets an expiring link to their assigned fields. The sender can revoke
                    access.
                  </p>
                </div>
              </article>
              <article>
                <Fingerprint />
                <div>
                  <h3>Consent at the point of signing</h3>
                  <p>
                    Recipients review the consent wording and confirm their intent before submitting a
                    typed or drawn signature.
                  </p>
                </div>
              </article>
              <article>
                <ListChecks />
                <div>
                  <h3>A copy with its signing history</h3>
                  <p>
                    The completion record includes server timestamps and document hashes that identify
                    the original and signed files.
                  </p>
                </div>
              </article>
            </div>
          </div>
        </section>
        <section id="touchlumo" className="crm-band">
          <div className="container crm-inner">
            <div className="crm-symbol">
              <Network size={36} />
            </div>
            <div>
              <h2>Work alongside Touchlumo.</h2>
              <p>
                Use LumoDossier on its own, or connect a Touchlumo workspace to link requests with
                customers, quotes and deals.
              </p>
            </div>
            <Link className="button light" href="/login">
              Open workspace
            </Link>
          </div>
        </section>
      </main>
      <footer className="container footer">
        <Brand small />
        <span>Sign. Send. Keep everything moving.</span>
      </footer>
    </div>
  );
}
