import { useEffect, useRef } from "react";

const SEGMENTS = 12;

export function VoiceBox({ getLevels, frameless = false }: { getLevels: () => [number, number, number]; frameless?: boolean }) {
  const cols = useRef<(HTMLDivElement | null)[][]>([[], [], []]);

  useEffect(() => {
    let raf = 0;
    const smooth = [0, 0, 0];
    // Columns are low / mid / high bands; the centre column carries the vowels, the outer ones the fundamentals and sibilance.
    const order = [0, 1, 2];
    const tick = () => {
      const levels = getLevels();
      cols.current.forEach((segments, column) => {
        const band = order[column] ?? 1;
        const target = levels[band] ?? 0;
        // Fast attack, slower release, like an LED meter.
        smooth[band] = target > smooth[band]! ? smooth[band]! + (target - smooth[band]!) * 0.6 : smooth[band]! + (target - smooth[band]!) * 0.25;
        const lit = Math.max(1, Math.round(smooth[band]! * (SEGMENTS / 2)));
        segments.forEach((element, index) => {
          if (!element) return;
          const distance = Math.abs(index - (SEGMENTS - 1) / 2);
          element.style.opacity = distance < lit ? "1" : "0.12";
        });
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [getLevels]);

  return (
    <div className={frameless ? "relative flex items-center justify-center py-2" : "voice-chamber relative flex min-h-56 items-center justify-center overflow-hidden border border-border bg-card/70 p-6"}>
      <div className={`relative z-10 flex items-center justify-center ${frameless ? "gap-3" : "gap-5"}`}>
        {[0, 1, 2].map((column) => (
          <div key={column} className={`flex flex-col gap-1.5 ${column === 1 ? (frameless ? "w-9" : "w-12") : (frameless ? "w-6" : "w-8")}`}>
            {Array.from({ length: SEGMENTS }).map((_, index) => {
              const cap = Math.abs(index - (SEGMENTS - 1) / 2) >= SEGMENTS / 2 - 2;
              return (
              <div
                key={index}
                ref={(element) => {
                  const segments = cols.current[column];
                  if (segments) segments[index] = element;
                }}
                className={`h-2 transition-opacity duration-75 ${cap ? "bg-amber shadow-amber" : "bg-primary shadow-signal"}`}
                style={{ opacity: 0.12 }}
              />
              );
            })}
          </div>
        ))}
      </div>
      {!frameless && <div className="absolute inset-x-5 bottom-4 flex items-center justify-between font-mono text-[9px] uppercase text-muted-foreground">
        <span>Voice matrix</span><span className="text-green">Live</span>
      </div>}
    </div>
  );
}

export function FrontScanner() {
  return (
    <div className="kitt-front-shell" role="img" aria-label="K.I.T.T. red scanner sweeping from side to side">
      <div className="kitt-front-track">
        <div className="kitt-front-sweep">
          <span className="kitt-front-trail kitt-front-trail-far" />
          <span className="kitt-front-trail kitt-front-trail-near" />
          <span className="kitt-front-lamp" />
          <span className="kitt-front-trail kitt-front-trail-near-right" />
          <span className="kitt-front-trail kitt-front-trail-far-right" />
        </div>
      </div>
    </div>
  );
}