'use client';

import { useState } from 'react';
import { inputClass } from '@/components/ui';
import { useT } from '@/i18n/client';
import { PRESETS, presetRange, type Preset } from '../reports/report-format';

export interface DateRange {
  from: string;
  to: string;
}

export const monthRange = (): DateRange => presetRange('month', new Date());

/** Date range chooser shared by the accounts tabs: presets plus custom dates. */
export function RangeBar({
  value,
  onChange,
}: {
  value: DateRange;
  onChange: (range: DateRange) => void;
}) {
  const t = useT();
  const [preset, setPreset] = useState<Preset>('month');
  return (
    <div className="flex flex-wrap items-end gap-2">
      <div className="flex flex-wrap gap-1" role="group" aria-label={t('reports.dateRangeLabel')}>
        {PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            aria-pressed={preset === p.id}
            onClick={() => {
              setPreset(p.id);
              if (p.id !== 'custom') onChange(presetRange(p.id, new Date()));
            }}
            className={`h-10 rounded-[6px] border px-3 text-sm ${
              preset === p.id
                ? 'border-primary-600 bg-primary-50 font-semibold text-primary-700'
                : 'border-border hover:bg-surface-2'
            }`}
          >
            {t(`reports.preset.${p.id}`)}
          </button>
        ))}
      </div>
      {preset === 'custom' ? (
        <>
          <label className="text-xs text-muted">
            {t('common.from')}
            <input
              type="date"
              dir="ltr"
              className={`${inputClass} w-40`}
              value={value.from}
              max={value.to}
              onChange={(e) => e.target.value && onChange({ ...value, from: e.target.value })}
            />
          </label>
          <label className="text-xs text-muted">
            {t('common.to')}
            <input
              type="date"
              dir="ltr"
              className={`${inputClass} w-40`}
              value={value.to}
              min={value.from}
              onChange={(e) => e.target.value && onChange({ ...value, to: e.target.value })}
            />
          </label>
        </>
      ) : null}
    </div>
  );
}
