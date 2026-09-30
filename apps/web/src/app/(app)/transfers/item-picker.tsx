'use client';

import { useEffect, useState } from 'react';
import { api, inputClass, useErrorText } from '@/components/ui';
import { useT } from '@/i18n/client';
import type { ItemRef } from './types';

interface Found {
  itemId: string;
  sku: string;
  name: string;
}

/** Type a name or code, pick an item. Returns the item with its units (largest first). */
export function ItemPicker({
  onPick,
  onError,
}: {
  onPick: (item: ItemRef) => void;
  onError: (message: string) => void;
}) {
  const t = useT();
  const errorText = useErrorText();
  const [q, setQ] = useState('');
  const [found, setFound] = useState<Found[]>([]);

  useEffect(() => {
    if (!q.trim()) return setFound([]);
    const timer = setTimeout(() => {
      api<{ rows: Found[] }>(`/api/items?q=${encodeURIComponent(q)}&pageSize=8`)
        .then((r) => setFound(r.rows))
        .catch(() => setFound([]));
    }, 150);
    return () => clearTimeout(timer);
  }, [q]);

  async function pick(f: Found) {
    try {
      const r = await api<{
        item: {
          id: string;
          sku: string;
          name: string;
          units: { name: string; factorToBase: number }[];
        };
      }>(`/api/items/${f.itemId}`);
      const units = [...r.item.units].sort((a, b) => b.factorToBase - a.factorToBase);
      onPick({ id: r.item.id, sku: r.item.sku, name: r.item.name, units });
      setQ('');
      setFound([]);
    } catch (e) {
      onError(errorText(e, 'transfers.itemPicker.addFailed'));
    }
  }

  return (
    <div className="relative">
      <input
        aria-label={t('transfers.itemPicker.aria')}
        className={inputClass}
        placeholder={t('transfers.itemPicker.placeholder')}
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      {found.length > 0 ? (
        <ul className="absolute z-10 mt-1 max-h-64 w-full overflow-y-auto rounded-[6px] border border-border bg-white shadow-lg">
          {found.map((f) => (
            <li key={f.itemId}>
              <button
                type="button"
                className="block w-full px-3 py-2 text-start text-sm hover:bg-primary-50"
                onClick={() => void pick(f)}
              >
                {f.name} <span className="text-xs text-muted">{f.sku}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
