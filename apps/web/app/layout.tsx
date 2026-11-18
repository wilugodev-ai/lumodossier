import type { Metadata } from 'next';
import '@fontsource/dm-sans/latin-400.css';
import '@fontsource/dm-sans/latin-500.css';
import '@fontsource/dm-sans/latin-600.css';
import '@fontsource/dm-sans/latin-700.css';
import '@fontsource/instrument-serif/latin-400.css';
import '@fontsource/instrument-serif/latin-400-italic.css';
import './styles.css';
import './atmosphere.css';
import './account.css';
import { MotionProvider } from '../components/Motion';

export const metadata: Metadata = {
  title: { default: 'LumoDossier | Electronic signatures', template: '%s | LumoDossier' },
  description:
    'Sign. Send. Keep everything moving. Prepare, sign and track business documents with LumoDossier.',
  applicationName: 'LumoDossier',
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-scroll-behavior="smooth">
      <body>
        <a className="skip" href="#main">
          Skip to content
        </a>
        <MotionProvider>{children}</MotionProvider>
      </body>
    </html>
  );
}
