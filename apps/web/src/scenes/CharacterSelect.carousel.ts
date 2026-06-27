export interface SlotStyles {
  x: string;
  w: string;
  h: string;
  scale: number;
  opacity: number;
  blur: string;
  textOpacity: number;
  zIndex: number;
}

/**
 * Calculates the shortest circular distance between index i and activeIndex,
 * where n is the total number of characters.
 * Symmetrical around 0. Range: [-floor((n-1)/2), floor(n/2)]
 */
export function circularOffset(i: number, active: number, n: number): number {
  if (n <= 0) return 0;
  let off = (((i - active) % n) + n) % n; // 0 .. n-1
  if (off > n / 2) off -= n;              //折到最短环形距离
  return off;
}

/**
 * Maps circular offset to visual slot variables according to requirements.
 */
export function slotForOffset(offset: number): SlotStyles {
  const abs = Math.abs(offset);
  if (abs > 2) {
    return {
      x: '0px',
      w: '0px',
      h: '0px',
      scale: 0,
      opacity: 0,
      blur: '0px',
      textOpacity: 0,
      zIndex: 0,
    };
  }

  if (offset === 0) {
    return {
      x: '0px',
      w: '340px',
      h: '520px',
      scale: 1,
      opacity: 1,
      blur: '0px',
      textOpacity: 1,
      zIndex: 100,
    };
  }

  if (offset === -1) {
    return {
      x: '-23vw',
      w: '260px',
      h: '430px',
      scale: 0.9,
      opacity: 0.68,
      blur: '0.6px',
      textOpacity: 0.55,
      zIndex: 80,
    };
  }

  if (offset === 1) {
    return {
      x: '23vw',
      w: '260px',
      h: '430px',
      scale: 0.9,
      opacity: 0.68,
      blur: '0.6px',
      textOpacity: 0.55,
      zIndex: 80,
    };
  }

  if (offset === -2) {
    return {
      x: '-44vw',
      w: '42px',
      h: '340px',
      scale: 0.88,
      opacity: 0.36,
      blur: '1.5px',
      textOpacity: 0,
      zIndex: 70,
    };
  }

  // offset === 2
  return {
    x: '44vw',
    w: '42px',
    h: '340px',
    scale: 0.88,
    opacity: 0.36,
    blur: '1.5px',
    textOpacity: 0,
    zIndex: 70,
  };
}
