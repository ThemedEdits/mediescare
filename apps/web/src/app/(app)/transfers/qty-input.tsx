'use client';

import { useState } from 'react';
import { inputClass } from '@/components/ui';
import type { UnitInfo } from './types';

/**
 * A quantity typed in one of the item's units (box, strip, tablet). The screen keeps the quantity in
 * the smallest unit, which is what the ledger uses, and converts here.
 */
export function QtyInput({
  units,
  valueBase,
  onChange,
  label,
  className = '',
}: {
  /** Largest unit first, the smallest unit last (factor 1). */
  units: UnitInfo[];
  valueBase: number;
  onChange: (base: number) => void;
  label: string;
  className?: string;
}) {
  const smallest = Math.max(units.length - 1, 0);
  const [unit, setUnit] = useState(smallest);
  const [text, setText] = useState(valueBase > 0 ? String(valueBase) : '');
  const factor = units[unit]?.factorToBase ?? 1;

  const emit = (t: string, f: number) => {
    setText(t);
    const n = Number(t);
    onChange(t.trim() !== '' && Number.isInteger(n) && n >= 0 ? n * f : 0);
  };

  return (
    <span className={`flex gap-1 ${className}`}>
      <input
        aria-label={label}
        inputMode="numeric"
        className={`${inputClass} w-24 text-end tabular-nums`}
        value={text}
        onChange={(e) => emit(e.target.value.replace(/[^\d]/g, ''), factor)}
      />
      {units.length > 1 ? (
        <select
          aria-label={`${label} unit`}
          className={`${inputClass} w-28`}
          value={unit}
          onChange={(e) => {
            const next = Number(e.target.value);
            setUnit(next);
            emit(text, units[next]?.factorToBase ?? 1);
          }}
        >
          {units.map((u, i) => (
            <option key={u.name} value={i}>
              {u.name}
            </option>
          ))}
        </select>
      ) : (
        <span className="self-center text-sm text-muted">{units[0]?.name ?? ''}</span>
      )}
    </span>
  );
}
