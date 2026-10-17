/**
 * 2D view transform between world coordinates (m, y up) and canvas pixels (y down).
 * screen = (cx + (x − wx)·scale, cy − (y − wy)·scale), where (wx, wy) is the world point at the canvas centre.
 */
export interface Camera {
  /** world point at the centre of the canvas, m */
  wx: number;
  wy: number;
  /** pixels per metre */
  scale: number;
  /** canvas size in CSS pixels */
  width: number;
  height: number;
}

export const toScreen = (c: Camera, x: number, y: number): [number, number] => [c.width / 2 + (x - c.wx) * c.scale, c.height / 2 - (y - c.wy) * c.scale];

export const toWorld = (c: Camera, sx: number, sy: number): [number, number] => [c.wx + (sx - c.width / 2) / c.scale, c.wy - (sy - c.height / 2) / c.scale];

/** camera showing the world rectangle [x0, x1] × [y0, y1] entirely, centred */
export function fit(width: number, height: number, x0: number, x1: number, y0: number, y1: number): Camera {
  const scale = Math.min(width / (x1 - x0), height / (y1 - y0));
  return { wx: 0.5 * (x0 + x1), wy: 0.5 * (y0 + y1), scale, width, height };
}

/** zoom by `factor` keeping the world point under screen point (sx, sy) fixed */
export function zoomAt(c: Camera, sx: number, sy: number, factor: number): Camera {
  const [x, y] = toWorld(c, sx, sy);
  const scale = c.scale * factor;
  return { ...c, scale, wx: x - (sx - c.width / 2) / scale, wy: y + (sy - c.height / 2) / scale };
}

export function panBy(c: Camera, dx: number, dy: number): Camera {
  return { ...c, wx: c.wx - dx / c.scale, wy: c.wy + dy / c.scale };
}
