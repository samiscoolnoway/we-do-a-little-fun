import type { Camera } from './camera';
import { toScreen } from './camera';
import { type ColormapName, colormapTable, sampleColormap } from './colormap';

/**
 * Draws a scalar field on the quadrilateral mesh. Every cell is drawn as its own quad (four vertices), so the
 * same geometry can show either the cell values themselves (flat: each cell one colour, exactly the computed
 * cell average) or node-averaged values interpolated across the cell (smooth). WebGL2 when available, otherwise
 * a slower Canvas 2D path that draws flat cells.
 */
const VS = `#version 300 es
in vec2 aPos;
in float aVal;
uniform vec2 uScale;
uniform vec2 uOffset;
out float vVal;
void main() {
  vVal = aVal;
  gl_Position = vec4(aPos * uScale + uOffset, 0.0, 1.0);
}`;
const FS = `#version 300 es
precision highp float;
in float vVal;
uniform float uMin;
uniform float uMax;
uniform sampler2D uMap;
out vec4 outColor;
void main() {
  float t = clamp((vVal - uMin) / max(uMax - uMin, 1e-30), 0.0, 1.0);
  outColor = texture(uMap, vec2(t, 0.5));
}`;

export class FieldRenderer {
  readonly canvas: HTMLCanvasElement;
  readonly webgl: boolean;
  private gl: WebGL2RenderingContext | null = null;
  private prog: WebGLProgram | null = null;
  private posBuf: WebGLBuffer | null = null;
  private valBuf: WebGLBuffer | null = null;
  private idxBuf: WebGLBuffer | null = null;
  private tex: WebGLTexture | null = null;
  private vao: WebGLVertexArrayObject | null = null;
  private nIdx = 0;
  private ni = 0;
  private nj = 0;
  private x: Float64Array | null = null;
  private y: Float64Array | null = null;
  private vals: Float32Array | null = null;
  private cellVals: Float32Array | null = null;
  private table = colormapTable('viridis');

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    let gl: WebGL2RenderingContext | null = null;
    try {
      gl = canvas.getContext('webgl2', { antialias: true, preserveDrawingBuffer: true });
    } catch {
      gl = null;
    }
    this.webgl = !!gl && this.initGL(gl);
  }

  private initGL(gl: WebGL2RenderingContext): boolean {
    const sh = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader');
      return s;
    };
    try {
      const p = gl.createProgram()!;
      gl.attachShader(p, sh(gl.VERTEX_SHADER, VS));
      gl.attachShader(p, sh(gl.FRAGMENT_SHADER, FS));
      gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) return false;
      this.gl = gl;
      this.prog = p;
      this.posBuf = gl.createBuffer();
      this.valBuf = gl.createBuffer();
      this.idxBuf = gl.createBuffer();
      this.vao = gl.createVertexArray();
      gl.bindVertexArray(this.vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuf);
      const aPos = gl.getAttribLocation(p, 'aPos');
      gl.enableVertexAttribArray(aPos);
      gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.valBuf);
      const aVal = gl.getAttribLocation(p, 'aVal');
      gl.enableVertexAttribArray(aVal);
      gl.vertexAttribPointer(aVal, 1, gl.FLOAT, false, 0, 0);
      gl.bindVertexArray(null);
      this.tex = gl.createTexture();
      this.uploadColormap();
      return true;
    } catch {
      this.gl = null;
      return false;
    }
  }

  private uploadColormap() {
    const gl = this.gl;
    if (!gl) return;
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 256, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, this.table);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  setColormap(name: ColormapName) {
    this.table = colormapTable(name);
    this.uploadColormap();
  }

  setMesh(ni: number, nj: number, x: Float64Array, y: Float64Array) {
    this.ni = ni;
    this.nj = nj;
    this.x = x;
    this.y = y;
    this.vals = new Float32Array(ni * nj * 4);
    const gl = this.gl;
    if (!gl) return;
    const pos = new Float32Array(ni * nj * 8);
    const idx = new Uint32Array(ni * nj * 6);
    const W = ni + 1;
    for (let j = 0; j < nj; j++)
      for (let i = 0; i < ni; i++) {
        const c = j * ni + i;
        const corners = [j * W + i, j * W + i + 1, (j + 1) * W + i + 1, (j + 1) * W + i];
        for (let k = 0; k < 4; k++) {
          pos[c * 8 + 2 * k] = x[corners[k]];
          pos[c * 8 + 2 * k + 1] = y[corners[k]];
        }
        const v = c * 4;
        idx.set([v, v + 1, v + 2, v, v + 2, v + 3], c * 6);
      }
    gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuf);
    gl.bufferData(gl.ARRAY_BUFFER, pos, gl.STATIC_DRAW);
    // the element-array binding is part of the vertex-array object's state
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.idxBuf);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    this.nIdx = idx.length;
  }

  /** cell values (flat) or, when `nodes` is given, node values interpolated across each cell (smooth) */
  setValues(cells: Float32Array, nodes: Float32Array | null) {
    const { ni, nj } = this;
    const vals = this.vals;
    if (!vals || cells.length !== ni * nj) return;
    this.cellVals = cells;
    const W = ni + 1;
    for (let j = 0; j < nj; j++)
      for (let i = 0; i < ni; i++) {
        const c = j * ni + i;
        if (nodes) {
          vals[c * 4] = nodes[j * W + i];
          vals[c * 4 + 1] = nodes[j * W + i + 1];
          vals[c * 4 + 2] = nodes[(j + 1) * W + i + 1];
          vals[c * 4 + 3] = nodes[(j + 1) * W + i];
        } else vals.fill(cells[c], c * 4, c * 4 + 4);
      }
    const gl = this.gl;
    if (!gl) return;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.valBuf);
    gl.bufferData(gl.ARRAY_BUFFER, vals, gl.DYNAMIC_DRAW);
  }

  draw(cam: Camera, vmin: number, vmax: number, background: string) {
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(cam.width * dpr));
    const h = Math.max(1, Math.round(cam.height * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    const gl = this.gl;
    if (gl && this.prog) {
      gl.viewport(0, 0, w, h);
      const bg = parseCss(background);
      gl.clearColor(bg[0], bg[1], bg[2], 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      if (!this.nIdx) return;
      gl.useProgram(this.prog);
      const sx = (2 * cam.scale) / cam.width;
      const sy = (2 * cam.scale) / cam.height;
      gl.uniform2f(gl.getUniformLocation(this.prog, 'uScale'), sx, sy);
      gl.uniform2f(gl.getUniformLocation(this.prog, 'uOffset'), -cam.wx * sx, -cam.wy * sy);
      gl.uniform1f(gl.getUniformLocation(this.prog, 'uMin'), vmin);
      gl.uniform1f(gl.getUniformLocation(this.prog, 'uMax'), vmax);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.tex);
      gl.uniform1i(gl.getUniformLocation(this.prog, 'uMap'), 0);
      gl.bindVertexArray(this.vao);
      gl.drawElements(gl.TRIANGLES, this.nIdx, gl.UNSIGNED_INT, 0);
      gl.bindVertexArray(null);
      return;
    }
    // Canvas 2D fallback: flat cells
    const ctx = this.canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, cam.width, cam.height);
    const { x, y, cellVals, ni, nj } = this;
    if (!x || !y || !cellVals) return;
    const W = ni + 1;
    for (let j = 0; j < nj; j++)
      for (let i = 0; i < ni; i++) {
        const c = j * ni + i;
        ctx.beginPath();
        for (const [k, n] of [j * W + i, j * W + i + 1, (j + 1) * W + i + 1, (j + 1) * W + i].entries()) {
          const [px, py] = toScreen(cam, x[n], y[n]);
          if (k === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.closePath();
        const col = sampleColormap(this.table, (cellVals[c] - vmin) / (vmax - vmin || 1));
        ctx.fillStyle = col;
        ctx.strokeStyle = col;
        ctx.lineWidth = 0.6;
        ctx.fill();
        ctx.stroke();
      }
  }
}

function parseCss(c: string): [number, number, number] {
  const m = c.trim().match(/^#([0-9a-f]{6})$/i);
  if (m) {
    const n = parseInt(m[1], 16);
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  }
  const r = c.match(/rgba?\(([^)]+)\)/);
  if (r) {
    const p = r[1].split(',').map((s) => parseFloat(s));
    return [p[0] / 255, p[1] / 255, p[2] / 255];
  }
  return [0, 0, 0];
}
