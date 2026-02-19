"use client";

import { usePathname } from "next/navigation";
import { type CSSProperties, useEffect, useRef, useState } from "react";

type StarParticle = {
  id: number;
  x: number;
  y: number;
  size: number;
  dx: number;
  dy: number;
  rotation: number;
  colorA: string;
  colorB: string;
};

type StarStyle = CSSProperties & {
  "--star-dx": string;
  "--star-dy": string;
  "--star-rot": string;
  "--star-color-a": string;
  "--star-color-b": string;
};

const ACTIVE_DURATION_MS = 2000;
const SPAWN_GAP_MS = 34;
const MAX_PARTICLES = 14;

const STAR_PALETTES: Array<[string, string]> = [
  ["#ffffff", "#bfdbfe"],
  ["#fef9c3", "#fde68a"],
  ["#e0f2fe", "#a5f3fc"],
];

function randomBetween(min: number, max: number) {
  return Math.random() * (max - min) + min;
}

export function CursorStarTail() {
  const pathname = usePathname();
  const [particles, setParticles] = useState<StarParticle[]>([]);

  const activeUntilRef = useRef(0);
  const lastSpawnAtRef = useRef(0);
  const nextIdRef = useRef(1);

  function triggerTrailWindow() {
    activeUntilRef.current = Date.now() + ACTIVE_DURATION_MS;
  }

  useEffect(() => {
    triggerTrailWindow();
  }, [pathname]);

  useEffect(() => {
    function onPointerMove(event: PointerEvent) {
      const now = Date.now();
      if (now > activeUntilRef.current) return;
      if (now - lastSpawnAtRef.current < SPAWN_GAP_MS) return;

      lastSpawnAtRef.current = now;
      const [colorA, colorB] = STAR_PALETTES[Math.floor(Math.random() * STAR_PALETTES.length)];
      const id = nextIdRef.current++;

      const particle: StarParticle = {
        id,
        x: event.clientX + randomBetween(-4, 4),
        y: event.clientY + randomBetween(-4, 4),
        size: randomBetween(7, 11),
        dx: randomBetween(-14, 14),
        dy: randomBetween(-12, 12),
        rotation: randomBetween(-80, 80),
        colorA,
        colorB,
      };

      setParticles((current) => {
        const trimmed = current.length >= MAX_PARTICLES ? current.slice(current.length - MAX_PARTICLES + 1) : current;
        return [...trimmed, particle];
      });
    }

    function onAnyButtonLikeClick(event: MouseEvent) {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (!target.closest("button, .btn-notch, a.bg-zinc-900")) return;
      triggerTrailWindow();
    }

    window.addEventListener("pointermove", onPointerMove, { passive: true });
    document.addEventListener("click", onAnyButtonLikeClick, true);

    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener("click", onAnyButtonLikeClick, true);
    };
  }, []);

  function removeParticle(id: number) {
    setParticles((current) => current.filter((particle) => particle.id !== id));
  }

  return (
    <div aria-hidden="true" className="cursor-stars-layer">
      {particles.map((particle) => {
        const style: StarStyle = {
          left: `${particle.x}px`,
          top: `${particle.y}px`,
          width: `${particle.size}px`,
          height: `${particle.size}px`,
          "--star-dx": `${particle.dx}px`,
          "--star-dy": `${particle.dy}px`,
          "--star-rot": `${particle.rotation}deg`,
          "--star-color-a": particle.colorA,
          "--star-color-b": particle.colorB,
        };

        return <span className="cursor-star" key={particle.id} onAnimationEnd={() => removeParticle(particle.id)} style={style} />;
      })}
    </div>
  );
}
