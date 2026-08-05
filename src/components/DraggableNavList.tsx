import { useRef, useState } from 'react';

export interface NavListItem {
  key: string;
  label: string;
  badge?: string;
}

interface DraggableNavListProps {
  items: NavListItem[];
  order: string[];
  onOrderChange: (order: string[]) => void;
  /**
   * Sæt for at vise fravælgelses-flueben ved hver linje. Udelades helt på
   * admin-siden, hvor der kun redigeres rækkefølge, ikke synlighed.
   */
  disabledKeys?: Set<string>;
  onToggleDisabled?: (key: string) => void;
  /** Nøgler der ikke kan slås fra (fluebenet vises deaktiveret og krydset af). */
  lockedKeys?: Set<string>;
}

/**
 * Liste, hvor rækkefølgen kan ændres ved træk-og-slip (mus) eller op/ned-
 * knapper (virker overalt, inklusive touch — HTML5's indbyggede
 * drag-and-drop understøttes ikke i de fleste mobilbrowsere, og appen
 * bruges primært på mobil, så knapperne er hovedvejen og trækket en genvej).
 */
export function DraggableNavList({
  items,
  order,
  onOrderChange,
  disabledKeys,
  onToggleDisabled,
  lockedKeys,
}: DraggableNavListProps) {
  const dragIndex = useRef<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  const byKey = new Map(items.map((p) => [p.key, p]));

  function move(index: number, delta: number) {
    const target = index + delta;
    if (target < 0 || target >= order.length) return;
    const next = [...order];
    [next[index], next[target]] = [next[target], next[index]];
    onOrderChange(next);
  }

  function handleDragStart(index: number) {
    dragIndex.current = index;
  }

  function handleDragOver(e: React.DragEvent, index: number) {
    e.preventDefault();
    setDragOverIndex(index);
    if (dragIndex.current === null || dragIndex.current === index) return;

    const next = [...order];
    const [moved] = next.splice(dragIndex.current, 1);
    next.splice(index, 0, moved);
    onOrderChange(next);
    dragIndex.current = index;
  }

  function handleDragEnd() {
    dragIndex.current = null;
    setDragOverIndex(null);
  }

  return (
    <ul className="space-y-1">
      {order.map((key, index) => {
        const item = byKey.get(key);
        if (!item) return null;
        const isDragTarget = dragOverIndex === index;
        const isLocked = lockedKeys?.has(key) ?? false;
        const isDisabled = disabledKeys?.has(key) ?? false;

        return (
          <li
            key={key}
            draggable
            onDragStart={() => handleDragStart(index)}
            onDragOver={(e) => handleDragOver(e, index)}
            onDragEnd={handleDragEnd}
            className={`flex items-center gap-3 rounded-lg border px-3 py-2 ${
              isDragTarget ? 'border-river-400 bg-river-50' : 'border-river-100'
            } ${isDisabled ? 'opacity-60' : ''}`}
          >
            <span
              className="cursor-grab select-none text-river-300 hover:text-river-500 active:cursor-grabbing"
              aria-hidden="true"
              title="Træk for at flytte"
            >
              <svg viewBox="0 0 20 20" className="h-4 w-4" fill="currentColor">
                <circle cx="7" cy="5" r="1.3" />
                <circle cx="13" cy="5" r="1.3" />
                <circle cx="7" cy="10" r="1.3" />
                <circle cx="13" cy="10" r="1.3" />
                <circle cx="7" cy="15" r="1.3" />
                <circle cx="13" cy="15" r="1.3" />
              </svg>
            </span>

            {onToggleDisabled && (
              <input
                type="checkbox"
                checked={!isDisabled}
                disabled={isLocked}
                onChange={() => onToggleDisabled(key)}
                title={isLocked ? 'Denne side kan ikke fjernes' : undefined}
              />
            )}

            <span className="flex-1 text-sm text-river-800">
              {item.label}
              {item.badge && (
                <span className="ml-2 rounded-full bg-sand-100 px-2 py-0.5 text-xs font-medium text-sand-600">
                  {item.badge}
                </span>
              )}
            </span>

            <div className="flex shrink-0 gap-1">
              <button
                type="button"
                className="rounded px-1.5 py-0.5 text-river-400 hover:bg-river-50 hover:text-river-700 disabled:opacity-30"
                onClick={() => move(index, -1)}
                disabled={index === 0}
                aria-label={`Flyt ${item.label} op`}
              >
                ↑
              </button>
              <button
                type="button"
                className="rounded px-1.5 py-0.5 text-river-400 hover:bg-river-50 hover:text-river-700 disabled:opacity-30"
                onClick={() => move(index, 1)}
                disabled={index === order.length - 1}
                aria-label={`Flyt ${item.label} ned`}
              >
                ↓
              </button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
