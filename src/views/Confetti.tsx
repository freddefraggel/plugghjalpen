import { useMemo } from 'react';

const COLORS = ['#2f5bea', '#f5b301', '#1e7a46', '#e8505b', '#8a5cf6', '#00a3c4'];

/** Lite konfetti som faller en gång. Visas inte för den som valt minskad rörelse. */
export default function Confetti({ pieces = 70 }: { pieces?: number }) {
  const bits = useMemo(
    () =>
      Array.from({ length: pieces }, (_, i) => ({
        left: Math.random() * 100,
        delay: Math.random() * 0.6,
        duration: 2.2 + Math.random() * 1.6,
        color: COLORS[i % COLORS.length],
        size: 6 + Math.random() * 6,
        turn: Math.random() * 720 - 360,
      })),
    [pieces],
  );
  return (
    <div className="confetti" aria-hidden="true">
      {bits.map((b, i) => (
        <span
          key={i}
          style={{
            left: `${b.left}%`,
            width: b.size,
            height: b.size * 0.45,
            background: b.color,
            animationDelay: `${b.delay}s`,
            animationDuration: `${b.duration}s`,
            ['--turn' as string]: `${b.turn}deg`,
          }}
        />
      ))}
    </div>
  );
}
