import { useEffect, useState } from 'react';
import type { AppViewModel } from '../../preload/api';

/** Latest view model from the main process (initial fetch + pushes). */
export function useViewModel(): AppViewModel | null {
  const [vm, setVm] = useState<AppViewModel | null>(null);
  useEffect(() => {
    let alive = true;
    void window.eve.getState().then((v) => alive && setVm(v));
    const off = window.eve.onState(setVm);
    return () => {
      alive = false;
      off();
    };
  }, []);
  return vm;
}
