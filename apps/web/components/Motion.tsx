'use client';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { Pause, Play } from 'lucide-react';
import { ProtectionScene } from './ProtectionScene';
const Motion = createContext({ playing: false, toggle: () => {} });
export function MotionProvider({ children }: { children: ReactNode }) {
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    function sync() {
      const saved = localStorage.getItem('lumo-motion');
      setPlaying(!query.matches && saved !== 'off');
    }
    sync();
    query.addEventListener('change', sync);
    return () => query.removeEventListener('change', sync);
  }, []);
  const toggle = () => {
    setPlaying((current) => {
      localStorage.setItem('lumo-motion', current ? 'off' : 'on');
      return !current;
    });
  };
  return (
    <Motion.Provider value={{ playing, toggle }}>
      <div className={'product-surface' + (playing ? ' motion-on' : ' motion-off')}>
        <div className="ambient-field" aria-hidden="true">
          <div className="ambient-mesh" />
          <div className="ambient-light" />
          <div className="ambient-lines" />
        </div>
        {children}
      </div>
    </Motion.Provider>
  );
}
export function MotionControl() {
  const { playing, toggle } = useContext(Motion);
  return (
    <button
      className="motion-control"
      onClick={toggle}
      aria-label={playing ? 'Pause background motion' : 'Play background motion'}
      title={playing ? 'Pause background motion' : 'Play background motion'}
    >
      {playing ? <Pause size={14} /> : <Play size={14} />}
      <span>{playing ? 'Pause motion' : 'Play motion'}</span>
    </button>
  );
}
export function SceneArt() {
  const { playing } = useContext(Motion);
  return <ProtectionScene playing={playing} />;
}
