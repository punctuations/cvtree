"use client";

import { useEffect, useRef } from "react";

const SKY = "#7fbdea";
const CELL = 18;
const ASPECT = 0.6;
const FRAME_MS = 50;

const GROUND_RAMP = ".:-=+*#%@";
const SKY_RAMP = ".'`~";

const GROUND_COLORS = [
  "rgba(86, 146, 150, 0.14)",
  "rgba(74, 136, 140, 0.20)",
  "rgba(64, 126, 128, 0.27)",
  "rgba(55, 115, 115, 0.34)",
  "rgba(46, 104, 102, 0.41)",
  "rgba(38, 92, 90, 0.47)",
  "rgba(31, 80, 78, 0.53)",
  "rgba(25, 68, 67, 0.58)",
  "rgba(20, 57, 57, 0.63)",
];

const SKY_COLORS = [
  "rgba(255, 255, 255, 0.12)",
  "rgba(255, 255, 255, 0.20)",
  "rgba(255, 255, 255, 0.30)",
  "rgba(255, 255, 255, 0.42)",
];

const LEVELS = GROUND_COLORS.length + SKY_COLORS.length;
const EMPTY = 255;

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = Math.min(Math.max((value - edge0) / (edge1 - edge0), 0), 1);
  return t * t * (3 - 2 * t);
}

function swell(col: number, row: number, time: number): number {
  return (
    (Math.sin(col * 0.09 + time * 0.32) * 0.5 +
      Math.sin(col * 0.045 - row * 0.11 - time * 0.24) * 0.36 +
      Math.sin((col + row * 1.7) * 0.06 + time * 0.19) * 0.32) /
    1.18
  );
}

function blades(col: number, row: number, time: number): number {
  return (
    (Math.sin(col * 0.61 + row * 0.29 + time * 0.85) * 0.5 +
      Math.sin(col * 0.34 - row * 0.47 - time * 0.62) * 0.38 +
      Math.sin(col * 1.13 + row * 0.13 + time * 1.1) * 0.22) /
    1.1
  );
}

function drift(col: number, row: number, time: number): number {
  return (
    (Math.sin(col * 0.071 + time * 0.15) * 0.5 +
      Math.sin(col * 0.039 - row * 0.15 + time * 0.1) * 0.34 +
      Math.sin((col + row * 1.3) * 0.052 - time * 0.08) * 0.3) /
    1.14
  );
}

function horizon(col: number, time: number): number {
  return (
    Math.sin(col * 0.052 + time * 0.13) * 0.55 + Math.sin(col * 0.019 - time * 0.09) * 0.45
  );
}

export function Scene() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const element = canvasRef.current;
    const drawing = element?.getContext("2d", { alpha: false });

    if (!element || !drawing) {
      return;
    }

    const canvas = element;
    const context = drawing;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let width = 0;
    let height = 0;
    let cols = 0;
    let rows = 0;
    let levels = new Uint8Array(0);
    let glyphs = new Uint8Array(0);
    let request = 0;
    let last = -Infinity;

    function resize() {
      const ratio = Math.min(window.devicePixelRatio || 1, 2);

      width = window.innerWidth;
      height = window.innerHeight;

      canvas.width = Math.max(1, Math.floor(width * ratio));
      canvas.height = Math.max(1, Math.floor(height * ratio));
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;

      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.textBaseline = "top";
      context.font = `${CELL}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;

      cols = Math.ceil(width / (CELL * ASPECT)) + 1;
      rows = Math.ceil(height / CELL) + 1;

      const cells = cols * rows;
      levels = new Uint8Array(cells);
      glyphs = new Uint8Array(cells);

      last = -Infinity;
    }

    function build(time: number) {
      for (let row = 0; row < rows; row += 1) {
        const depth = row / rows;
        const fade = smoothstep(0.3, 0.7, depth);
        const haze = smoothstep(0.3, 0.52, depth) * 0.7;
        const offset = row * cols;

        for (let col = 0; col < cols; col += 1) {
          const index = offset + col;
          const shift = horizon(col, time) * 0.05;
          const ground = smoothstep(0.46 + shift, 1.01 + shift, depth);

          if (fade > 0.002) {
            const density =
              ground * 0.7 +
              swell(col, row, time) * 0.26 * fade +
              blades(col, row, time) * 0.17 * fade +
              depth * 0.08;

            if (density > 0.05) {
              const step = Math.min(
                GROUND_COLORS.length - 1,
                Math.max(0, Math.floor(density * GROUND_COLORS.length)),
              );
              levels[index] = step;
              glyphs[index] = step;
              continue;
            }
          }

          const cloud = drift(col, row, time) - haze;

          if (cloud > 0.34) {
            const step = Math.min(
              SKY_COLORS.length - 1,
              Math.floor(((cloud - 0.34) / 0.5) * SKY_COLORS.length),
            );
            levels[index] = GROUND_COLORS.length + step;
            glyphs[index] = step;
            continue;
          }

          levels[index] = EMPTY;
        }
      }
    }

    function paint() {
      context.fillStyle = SKY;
      context.fillRect(0, 0, width, height);

      const cellWidth = CELL * ASPECT;

      for (let level = 0; level < LEVELS; level += 1) {
        const isGround = level < GROUND_COLORS.length;

        context.fillStyle = isGround
          ? GROUND_COLORS[level]
          : SKY_COLORS[level - GROUND_COLORS.length];

        const ramp = isGround ? GROUND_RAMP : SKY_RAMP;

        for (let row = 0; row < rows; row += 1) {
          const offset = row * cols;
          const y = row * CELL;

          for (let col = 0; col < cols; col += 1) {
            const index = offset + col;

            if (levels[index] !== level) {
              continue;
            }

            context.fillText(ramp[glyphs[index]], col * cellWidth, y);
          }
        }
      }
    }

    function render(now: number) {
      request = window.requestAnimationFrame(render);

      if (now - last < FRAME_MS) {
        return;
      }

      last = now;
      build(now / 1000);
      paint();
    }

    function paintStill() {
      build(0);
      paint();
    }

    function onResize() {
      resize();

      if (still) {
        paintStill();
      }
    }

    resize();

    if (still) {
      paintStill();
    } else {
      request = window.requestAnimationFrame(render);
    }

    window.addEventListener("resize", onResize);

    return () => {
      window.cancelAnimationFrame(request);
      window.removeEventListener("resize", onResize);
    };
  }, []);

  return (
    <div className="scene" aria-hidden="true">
      <canvas ref={canvasRef} />
    </div>
  );
}
