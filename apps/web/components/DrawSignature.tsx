'use client';
import { useRef, type PointerEvent } from 'react';
export function DrawSignature({
  id,
  strokes,
  onChange,
}: {
  id: string;
  strokes: number[][][];
  onChange: (v: number[][][]) => void;
}) {
  const active = useRef<{
    pointer: number;
    points: number[][];
    previous: number[][][];
    remainingPoints: number;
  } | null>(null);
  function point(e: PointerEvent<SVGSVGElement>) {
    const box = e.currentTarget.getBoundingClientRect();
    return [
      Math.max(0, Math.min(1, (e.clientX - box.left) / box.width)),
      Math.max(0, Math.min(1, (e.clientY - box.top) / box.height)),
    ];
  }
  function down(e: PointerEvent<SVGSVGElement>) {
    const remainingPoints = 6000 - strokes.reduce((n, stroke) => n + stroke.length, 0);
    if (active.current || strokes.length >= 50 || remainingPoints < 2) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    active.current = { pointer: e.pointerId, points: [point(e)], previous: strokes, remainingPoints };
  }
  function move(e: PointerEvent<SVGSVGElement>) {
    const s = active.current;
    if (!s || s.pointer !== e.pointerId || s.points.length >= Math.min(1000, s.remainingPoints)) return;
    s.points.push(point(e));
    onChange([...s.previous, [...s.points]]);
  }
  return (
    <div className="draw-box">
      <svg
        id={id}
        tabIndex={-1}
        viewBox="0 0 400 120"
        preserveAspectRatio="none"
        role="img"
        aria-label="Draw your signature here"
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={() => (active.current = null)}
        onPointerCancel={() => (active.current = null)}
      >
        {strokes.map((s, i) => (
          <polyline
            key={i}
            points={s.map((p) => p[0] * 400 + ',' + p[1] * 120).join(' ')}
            fill="none"
            stroke="currentColor"
            strokeWidth="2.25"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}
      </svg>
      <button
        type="button"
        className="link-button"
        onClick={() => {
          active.current = null;
          onChange([]);
        }}
      >
        Clear drawing
      </button>
    </div>
  );
}
