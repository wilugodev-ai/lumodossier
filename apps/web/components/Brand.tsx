import Link from 'next/link';
export function Brand({ home = '/', small = false }: { home?: string; small?: boolean }) {
  return (
    <Link className={'brand' + (small ? ' small' : '')} href={home} aria-label="LumoDossier home">
      <span className="brand-mark" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
      <span>
        Lumo<span className="brand-light">Dossier</span>
      </span>
    </Link>
  );
}
