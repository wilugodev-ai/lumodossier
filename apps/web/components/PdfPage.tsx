'use client';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { ChevronLeft, ChevronRight, ZoomIn, ZoomOut } from 'lucide-react';
import { access, message, request } from '../lib/client';
import type { PageInfo } from '../lib/types';

export function PdfPage({
  path,
  token,
  pages,
  page,
  onPage,
  children,
}: {
  path: string;
  token?: string;
  pages: PageInfo[];
  page: number;
  onPage: (n: number) => void;
  children?: ReactNode;
}) {
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null),
    [error, setError] = useState(''),
    [zoom, setZoom] = useState(100),
    [ready, setReady] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let live = true,
      dispose: (() => void) | undefined;
    setDoc(null);
    setError('');
    setReady(false);
    (async () => {
      const [pdf, bytes] = await Promise.all([
        import('pdfjs-dist'),
        (await request(path, token ?? (await access()))).arrayBuffer(),
      ]);
      if (!live) return;
      pdf.GlobalWorkerOptions.workerSrc = '/pdfjs/pdf.worker.min.mjs';
      const task = pdf.getDocument({
        data: new Uint8Array(bytes),
        cMapUrl: '/pdfjs/cmaps/',
        cMapPacked: true,
        standardFontDataUrl: '/pdfjs/standard_fonts/',
        wasmUrl: '/pdfjs/wasm/',
        iccUrl: '/pdfjs/iccs/',
      });
      dispose = () => {
        void task.destroy();
      };
      const opened = await task.promise;
      if (live) setDoc(opened);
    })().catch((e) => {
      if (live) setError(message(e));
    });
    return () => {
      live = false;
      dispose?.();
    };
  }, [path, token]);
  useEffect(() => {
    if (!doc || !canvas.current) return;
    const el = canvas.current;
    let live = true,
      cancel: (() => void) | undefined;
    setReady(false);
    (async () => {
      const p = await doc.getPage(page + 1);
      if (!live) return;
      const base = p.getViewport({ scale: 1 }),
        scale = Math.min(
          2600 / Math.max(base.width, base.height),
          (Math.max(1, Math.min(2, window.devicePixelRatio)) * Math.max(el.clientWidth, 650)) /
            base.width,
        );
      const view = p.getViewport({ scale });
      el.width = Math.ceil(view.width);
      el.height = Math.ceil(view.height);
      const render = p.render({ canvas: el, viewport: view });
      cancel = () => render.cancel();
      await render.promise;
      if (live) setReady(true);
    })().catch((e) => {
      if (live) setError(message(e));
    });
    return () => {
      live = false;
      cancel?.();
    };
  }, [doc, page, zoom]);
  const info = pages[page] ?? { width: 612, height: 792 };
  return (
    <div className="preview">
      <div className="preview-tools">
        <div className="inline">
          <button
            className="icon-btn"
            aria-label="Previous page"
            disabled={page === 0}
            onClick={() => onPage(page - 1)}
          >
            <ChevronLeft size={18} />
          </button>
          <span>
            Page {page + 1} of {pages.length}
          </span>
          <button
            className="icon-btn"
            aria-label="Next page"
            disabled={page >= pages.length - 1}
            onClick={() => onPage(page + 1)}
          >
            <ChevronRight size={18} />
          </button>
        </div>
        <div className="inline">
          <button
            className="icon-btn"
            aria-label="Zoom out"
            disabled={zoom <= 75}
            onClick={() => setZoom(zoom - 25)}
          >
            <ZoomOut size={17} />
          </button>
          <span>{zoom}%</span>
          <button
            className="icon-btn"
            aria-label="Zoom in"
            disabled={zoom >= 175}
            onClick={() => setZoom(zoom + 25)}
          >
            <ZoomIn size={17} />
          </button>
        </div>
      </div>
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      <div className="paper-scroll">
        <div
          className="paper-frame"
          style={{ width: zoom + '%', aspectRatio: info.width + '/' + info.height }}
        >
          <canvas ref={canvas} role="img" aria-label={'Document preview, page ' + (page + 1)} />
          {!ready && !error && (
            <span className="preview-loading" role="status">
              Loading page…
            </span>
          )}
          {ready && children}
        </div>
      </div>
    </div>
  );
}
