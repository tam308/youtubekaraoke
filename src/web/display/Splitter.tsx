import { useState } from 'react';

/**
 * Drag handle between the control pane and the video. While dragging, a full-screen shield
 * sits above the YouTube iframe, because iframes swallow mouse events.
 */
export function Splitter({ onChange, onCommit }: { onChange: (ratio: number) => void; onCommit: (ratio: number) => void }) {
  const [dragging, setDragging] = useState(false);

  function start(e: React.PointerEvent) {
    e.preventDefault();
    setDragging(true);
    let last = 0;
    const move = (ev: PointerEvent) => {
      last = Math.min(0.6, Math.max(0.15, ev.clientX / window.innerWidth));
      onChange(last);
    };
    const up = () => {
      setDragging(false);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (last) onCommit(last);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  return (
    <>
      <div className="splitter" onPointerDown={start} role="separator" aria-orientation="vertical" title="Drag to resize" />
      {dragging && <div className="drag-shield" />}
    </>
  );
}
