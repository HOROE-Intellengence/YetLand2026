import { useEffect, useRef, useState } from 'react';

export function useFullscreen() {
  const ref = useRef<HTMLDivElement>(null);
  const [fullscreen, setFullscreen] = useState(false);
  useEffect(() => {
    const update = () => setFullscreen(Boolean(ref.current?.matches(':fullscreen')));
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && ref.current?.matches(':fullscreen')) {
        event.preventDefault();
        void document.exitFullscreen().catch(() => undefined);
      }
    };
    document.addEventListener('fullscreenchange', update);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('fullscreenchange', update);
      document.removeEventListener('keydown', escape);
    };
  }, []);
  function toggle() {
    const action = ref.current?.matches(':fullscreen') ? document.exitFullscreen() : ref.current?.requestFullscreen();
    void action?.catch(() => undefined);
  }
  return { ref, fullscreen, toggle };
}
