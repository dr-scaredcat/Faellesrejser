import { useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';

interface ZoomableImageProps {
  src: string;
  alt: string;
  /** Vises oven på billedet, inde i samme zoom/panorér-lag — så det følger med. */
  children?: ReactNode;
  minScale?: number;
  maxScale?: number;
  /** Skalaen et dobbeltklik/-tryk zoomer til, når billedet ikke allerede er zoomet. */
  doubleTapScale?: number;
  className?: string;
}

interface PointerInfo {
  x: number;
  y: number;
}

/**
 * Zoombar, panorérbar billedfremviser. Bygget på Pointer Events i stedet for
 * separate mus-/touch-håndtering, så mus, finger og pen opfører sig ens uden
 * at skulle skrive koden to gange — og uden at tilføje et nyt bibliotek til
 * projektet.
 *
 * Understøtter: ét-finger panorering, to-finger klemme-zoom (ankret i
 * punktet mellem fingrene, så det du klemmer om, bliver ved med at være
 * under fingrene), museklik-hjul-zoom på desktop, og dobbeltklik/-tryk for
 * at zoome ind eller nulstille.
 */
export function ZoomableImage({
  src,
  alt,
  children,
  minScale = 1,
  maxScale = 5,
  doubleTapScale = 2.5,
  className,
}: ZoomableImageProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [translate, setTranslate] = useState({ x: 0, y: 0 });

  // Aktive pegepunkter (fingre/mus), nøglet på pointerId. Bruges til at
  // afgøre om der panoreres (1 punkt) eller klemme-zoomes (2 punkter).
  const pointers = useRef<Map<number, PointerInfo>>(new Map());
  const lastMidpoint = useRef<PointerInfo | null>(null);
  const lastDistance = useRef<number | null>(null);
  const lastTapTime = useRef(0);

  function clampScale(value: number) {
    return Math.min(maxScale, Math.max(minScale, value));
  }

  /**
   * Holder billedet inden for rimelig rækkevidde af skærmen — man kan ikke
   * panorere det helt ud af syne. Grænsen er bevidst rummelig snarere end
   * pixel-præcis, så det ikke føles stramt at bruge.
   */
  function clampTranslate(x: number, y: number, currentScale: number) {
    const container = containerRef.current;
    if (!container) return { x, y };
    const { width, height } = container.getBoundingClientRect();
    const maxX = (width * (currentScale - 1)) / 2 + width * 0.4;
    const maxY = (height * (currentScale - 1)) / 2 + height * 0.4;
    return {
      x: Math.min(maxX, Math.max(-maxX, x)),
      y: Math.min(maxY, Math.max(-maxY, y)),
    };
  }

  function reset() {
    setScale(1);
    setTranslate({ x: 0, y: 0 });
  }

  function zoomAt(clientX: number, clientY: number, nextScale: number) {
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const originX = clientX - rect.left - rect.width / 2;
    const originY = clientY - rect.top - rect.height / 2;

    setScale((prevScale) => {
      const clamped = clampScale(nextScale);
      const factor = clamped / prevScale;
      setTranslate((prevTranslate) => {
        // Punktet under markøren/fingrene skal blive ved med at være der,
        // så vi flytter panoreringen tilsvarende, når skalaen ændres.
        const nextX = originX - (originX - prevTranslate.x) * factor;
        const nextY = originY - (originY - prevTranslate.y) * factor;
        return clampTranslate(nextX, nextY, clamped);
      });
      return clamped;
    });
  }

  function handlePointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    lastMidpoint.current = null;
    lastDistance.current = null;

    if (pointers.current.size === 1) {
      const now = Date.now();
      if (now - lastTapTime.current < 300) {
        // Dobbeltklik/-tryk: zoom ind på tappunktet, eller nulstil hvis der
        // allerede er zoomet ind.
        if (scale > minScale + 0.05) reset();
        else zoomAt(e.clientX, e.clientY, doubleTapScale);
      }
      lastTapTime.current = now;
    }
  }

  function handlePointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    const active = [...pointers.current.values()];

    if (active.length === 1) {
      const [p] = active;
      const last = lastMidpoint.current ?? p;
      const dx = p.x - last.x;
      const dy = p.y - last.y;
      setTranslate((prev) => clampTranslate(prev.x + dx, prev.y + dy, scale));
      lastMidpoint.current = p;
    } else if (active.length === 2) {
      const [a, b] = active;
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      const midpoint = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };

      if (lastDistance.current != null) {
        const factor = distance / lastDistance.current;
        zoomAt(midpoint.x, midpoint.y, scale * factor);
      }

      lastDistance.current = distance;
      lastMidpoint.current = midpoint;
    }
  }

  function handlePointerUp(e: ReactPointerEvent<HTMLDivElement>) {
    pointers.current.delete(e.pointerId);
    lastMidpoint.current = null;
    lastDistance.current = null;

    // Går man fra to fingre til én, skal panoreringen starte forfra fra det
    // resterende punkt, så billedet ikke hopper.
    const remaining = [...pointers.current.values()];
    if (remaining.length === 1) lastMidpoint.current = remaining[0];
  }

  function handleWheel(e: React.WheelEvent<HTMLDivElement>) {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    zoomAt(e.clientX, e.clientY, scale * factor);
  }

  return (
    <div
      ref={containerRef}
      className={`relative touch-none overflow-hidden select-none ${className ?? ''}`}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onWheel={handleWheel}
    >
      <div
        style={{
          transform: `translate(${translate.x}px, ${translate.y}px) scale(${scale})`,
          transformOrigin: 'center center',
          transition: pointers.current.size > 0 ? 'none' : 'transform 0.15s ease-out',
        }}
      >
        {/*
          Billedet fylder sin boks helt uden beskæring (block + w-full +
          h-auto, ingen object-fit). Det er bevidst: children (fx klikbare
          zoner) positioneres i procent relativt til DENNE boks, og skal den
          ramme rigtigt, skal boksen være nøjagtig lig billedets synlige
          areal — enhver brevkasse-beskæring ville forskyde zonerne.
        */}
        <img
          src={src}
          alt={alt}
          className="pointer-events-none block w-full select-none"
          draggable={false}
        />
        {children}
      </div>

      {scale > minScale + 0.05 && (
        <button
          type="button"
          onClick={reset}
          className="absolute right-3 top-3 rounded-full bg-river-800/80 px-3 py-1.5 text-xs text-white shadow"
        >
          Nulstil visning
        </button>
      )}
    </div>
  );
}
