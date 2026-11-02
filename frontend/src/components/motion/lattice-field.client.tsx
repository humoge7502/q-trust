"use client";

/**
 * "Quantum lattice" hero field — a hand-written WebGL1 shader, no three.js.
 * A slow domain-warped lattice in the brand's quantum cyan over the night
 * canvas, with a soft pointer-following glow. ~3KB of code instead of a
 * megabyte 3D engine: the CI budget (LCP ≤ 2.5s, CLS ≤ 0.1) and the product's
 * own honesty rules forbid a renderer dependency for a background.
 *
 * Progressive enhancement, in order: reduced motion → not mounted (the CSS
 * `.hero-grid` treatment stands alone); no WebGL context → blank canvas over
 * the CSS; context lost at runtime → drawing stops, CSS remains. The canvas
 * is absolutely positioned UNDER the hero content, so it can never affect
 * layout (CLS) or intercept pointers.
 *
 * Cost guards: DPR capped at 1.75 (1.25 on <768px viewports, which also render
 * at 0.66× resolution), one fullscreen quad, rAF skips drawing while the hero
 * is offscreen or the tab is hidden, pointer state eased toward its target so
 * the glow never snaps.
 */
import { useEffect, useRef } from "react";
import { prefersReducedMotion } from "@/lib/motion";

const VERT = `
attribute vec2 aPos;
varying vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}
`;

const FRAG = `
precision mediump float;
uniform vec2 uRes;
uniform float uTime;
uniform vec2 uMouse;
varying vec2 vUv;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}

void main() {
  vec2 uv = vUv;
  float aspect = uRes.x / uRes.y;
  vec2 p = (uv - vec2(0.5, 0.42)) * vec2(aspect, 1.0);
  float t = uTime * 0.045;

  // Two-octave domain warp: the lattice breathes instead of scrolling.
  vec2 q = vec2(noise(p * 1.3 + t), noise(p * 1.3 - t + 5.2));
  vec2 r = vec2(noise(p * 2.1 + q * 1.5 + vec2(1.7, 9.2) + t * 1.5),
                noise(p * 2.1 + q * 1.5 + vec2(8.3, 2.8) - t));

  vec2 g = p * 6.5 + r * 1.35;
  vec2 gf = abs(fract(g) - 0.5);
  float d = 0.5 - min(gf.x, gf.y);
  float line = smoothstep(0.05, 0.0, d);

  float shimmer = 0.6 + 0.4 * noise(p * 3.0 - t * 2.2);
  float fade = smoothstep(-0.05, 0.5, uv.y); // content zone at the bottom stays dark

  vec2 m = uMouse * vec2(aspect, 1.0) * 0.5;
  vec2 dm = p - m;
  float glow = exp(-dot(dm, dm) * 5.0);

  vec3 deep = vec3(0.0078, 0.0235, 0.0902);  // #020617 — the night canvas itself
  vec3 lineCol = vec3(0.133, 0.827, 0.933);  // #22d3ee — quantum
  float lum = line * shimmer * fade * (0.16 + 0.10 * glow);
  vec3 col = deep + lineCol * lum + lineCol * glow * 0.045 * fade;
  gl_FragColor = vec4(col, 1.0);
}
`;

function compileShader(gl: WebGLRenderingContext, type: number, source: string): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

export function LatticeField({ className = "" }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (prefersReducedMotion()) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const gl = canvas.getContext("webgl", {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      powerPreference: "low-power",
    });
    if (!gl) return;

    const vs = compileShader(gl, gl.VERTEX_SHADER, VERT);
    const fs = compileShader(gl, gl.FRAGMENT_SHADER, FRAG);
    const program = vs && fs ? gl.createProgram() : null;
    if (!program || !vs || !fs) return;
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return;
    gl.useProgram(program);

    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(program, "aPos");
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    const uRes = gl.getUniformLocation(program, "uRes");
    const uTime = gl.getUniformLocation(program, "uTime");
    const uMouse = gl.getUniformLocation(program, "uMouse");

    let dead = false;
    let visible = true;
    let raf = 0;
    let disposed = false;
    const mouse = { x: 0, y: 0 };
    const target = { x: 0, y: 0 };
    let hasPointer = false;
    const t0 = performance.now();

    const resize = () => {
      if (disposed) return;
      const rect = canvas.getBoundingClientRect();
      const mobile = window.innerWidth < 768;
      const dpr = Math.min(window.devicePixelRatio || 1, mobile ? 1.25 : 1.75);
      const scale = mobile ? 0.66 : 1;
      canvas.width = Math.max(1, Math.round(rect.width * dpr * scale));
      canvas.height = Math.max(1, Math.round(rect.height * dpr * scale));
      gl.viewport(0, 0, canvas.width, canvas.height);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    const onPointerMove = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      target.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      target.y = 1 - ((event.clientY - rect.top) / rect.height) * 2;
      hasPointer = true;
    };
    window.addEventListener("pointermove", onPointerMove, { passive: true });

    const io = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; }, { threshold: 0 });
    io.observe(canvas);

    const onContextLost = (event: Event) => {
      event.preventDefault();
      dead = true; // CSS treatment stands alone; do not attempt recovery
    };
    canvas.addEventListener("webglcontextlost", onContextLost);

    const frame = () => {
      if (disposed) return;
      raf = requestAnimationFrame(frame);
      if (dead || !visible || document.hidden) return;
      // No pointer yet (touch devices): the gaze point drifts on its own orbit.
      if (!hasPointer) {
        const t = (performance.now() - t0) / 1000;
        target.x = Math.cos(t * 0.3) * 0.45;
        target.y = Math.sin(t * 0.23) * 0.3;
      }
      mouse.x += (target.x - mouse.x) * 0.06;
      mouse.y += (target.y - mouse.y) * 0.06;
      gl.uniform2f(uRes, canvas.width, canvas.height);
      gl.uniform1f(uTime, (performance.now() - t0) / 1000);
      gl.uniform2f(uMouse, mouse.x, mouse.y);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };
    raf = requestAnimationFrame(frame);

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      window.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("webglcontextlost", onContextLost);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    };
  }, []);

  return <canvas ref={canvasRef} className={className} aria-hidden="true" />;
}
