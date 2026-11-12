// A custom AG Studio widget: the "payment rhythm" heatmap. Rows are families, columns are billed
// months, and each cell is coloured by how many days that bill took to pay.
import type { AgDefaultWidgetDefinition, AgWidgetData, AgWidgetDataFormat, AgWidgetField, AgWidgetFieldReference, AgWidgetParams } from 'ag-studio';
import type { AgRegistry, AgWidgetDefinition } from 'ag-studio-react';
import { useEffect, useMemo, useState } from 'react';

// Saved state holds field references; the component receives them resolved to fields.
type Mapping = { row: AgWidgetFieldReference[]; column: AgWidgetFieldReference[]; value: AgWidgetFieldReference[] };
type Style = { onTimeDays?: number; lateDays?: number };
// Like Studio's own widgets, the saved state carries its widget type.
export interface HeatmapData extends AgWidgetData<Mapping, AgWidgetDataFormat<Style>> {
  type: 'payment-heatmap';
}
export type HeatmapDefinition = AgWidgetDefinition<'payment-heatmap', HeatmapData>;
// Studio's built-in widgets plus ours, so report state and the widget menu can name it.
export interface TanpuraRegistry extends AgRegistry {
  widgets: readonly (AgDefaultWidgetDefinition | HeatmapDefinition)[];
}

// A small grid icon for Studio's widget menu.
const GRID_ICON = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#0070E0"><rect x="3" y="3" width="5" height="5" rx="1"/><rect x="9.5" y="3" width="5" height="5" rx="1"/><rect x="16" y="3" width="5" height="5" rx="1"/><rect x="3" y="9.5" width="5" height="5" rx="1"/><rect x="9.5" y="9.5" width="5" height="5" rx="1"/><rect x="16" y="9.5" width="5" height="5" rx="1"/><rect x="3" y="16" width="5" height="5" rx="1"/><rect x="9.5" y="16" width="5" height="5" rx="1"/><rect x="16" y="16" width="5" height="5" rx="1"/></svg>')}`;

const COLORS = { onTime: '#2E9E6E', late: '#E3A008', veryLate: '#C2253D', none: 'rgba(128, 128, 128, 0.18)' };

// Result rows are keyed by field; look the value up by the field's id (with or without its
// aggregation), falling back to the field's position.
function read(row: Record<string, unknown>, field: AgWidgetField, index: number): unknown {
  const { id, aggregation } = field as unknown as { id: string; aggregation?: string };
  for (const key of [id, aggregation && `${id}::${aggregation}`, aggregation && `${aggregation}(${id})`]) {
    if (key && key in row) return row[key];
  }
  return Object.values(row)[index];
}

const label = (v: unknown): string => {
  if (v instanceof Date) return v.toLocaleDateString('en-GB', { month: 'short', year: '2-digit' });
  if (typeof v === 'number' && v > 10_000_000_000) return label(new Date(v));
  if (typeof v === 'string' && /^\d{4}-\d{2}/.test(v)) return label(new Date(`${v.slice(0, 10)}T12:00:00Z`));
  return v == null ? '–' : String(v);
};
const sortKey = (v: unknown) => (v instanceof Date ? v.getTime() : typeof v === 'string' && /^\d{4}-\d{2}/.test(v) ? Date.parse(v) : String(v));

function PaymentHeatmap(props: AgWidgetParams<HeatmapData>) {
  const { dataMapping, widgetApi, format } = props;
  const onTime = format?.style?.onTimeDays ?? 7;
  const late = format?.style?.lateDays ?? 14;
  const fields = useMemo(() => [dataMapping.row?.[0], dataMapping.column?.[0], dataMapping.value?.[0]], [dataMapping]);
  const [rows, setRows] = useState<Record<string, unknown>[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (fields.some((f) => !f)) return;
    let live = true;
    widgetApi
      .getData({ fields: fields as AgWidgetField[] })
      .then((r) => live && setRows(r.results.rows))
      .catch((e: Error) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [fields, widgetApi, props.config]);

  if (fields.some((f) => !f)) return <Message text="Add a family field, a month field and a days-to-pay value." />;
  if (error) return <Message text={error} />;
  if (!rows) return <Message text="Loading…" />;
  if (!rows.length) return <Message text="No invoices to show." />;

  const cells = rows.map((r) => ({ row: read(r, fields[0]!, 0), col: read(r, fields[1]!, 1), value: Number(read(r, fields[2]!, 2)) }));
  const rowKeys = [...new Set(cells.map((c) => label(c.row)))].sort();
  const colValues = [...new Map(cells.map((c) => [label(c.col), c.col])).entries()].sort((a, b) => (sortKey(a[1]) < sortKey(b[1]) ? -1 : 1));
  const lookup = new Map(cells.map((c) => [`${label(c.row)}|${label(c.col)}`, c.value]));
  const color = (v: number | undefined) => (v === undefined || Number.isNaN(v) ? COLORS.none : v <= onTime ? COLORS.onTime : v <= late ? COLORS.late : COLORS.veryLate);

  return (
    <div style={{ height: '100%', overflow: 'auto', padding: 12, fontFamily: 'IBM Plex Sans, system-ui, sans-serif', fontSize: 12 }}>
      <div style={{ display: 'grid', gridTemplateColumns: `minmax(120px, max-content) repeat(${colValues.length}, minmax(44px, 1fr))`, gap: 3 }}>
        <div />
        {colValues.map(([name]) => (
          <div key={name} style={{ textAlign: 'center', opacity: 0.75, fontWeight: 600 }}>
            {name}
          </div>
        ))}
        {rowKeys.map((row) => (
          <div key={row} style={{ display: 'contents' }}>
            <div style={{ paddingRight: 8, whiteSpace: 'nowrap', alignSelf: 'center' }}>{row}</div>
            {colValues.map(([col]) => {
              const v = lookup.get(`${row}|${col}`);
              return (
                <div
                  key={col}
                  title={v === undefined ? `${row}, ${col}: no invoice` : `${row}, ${col}: ${Math.round(v)} days to pay`}
                  style={{ background: color(v), color: v === undefined ? 'inherit' : '#fff', opacity: v === undefined ? 0.6 : 1, borderRadius: 4, textAlign: 'center', padding: '6px 0', fontWeight: 600 }}
                >
                  {v === undefined || Number.isNaN(v) ? '·' : `${Math.round(v)}d`}
                </div>
              );
            })}
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 12, marginTop: 10, opacity: 0.75 }}>
        <Legend color={COLORS.onTime} text={`paid within ${onTime} days`} />
        <Legend color={COLORS.late} text={`${onTime + 1}–${late} days`} />
        <Legend color={COLORS.veryLate} text={`over ${late} days (or still open)`} />
      </div>
    </div>
  );
}

const Legend = ({ color, text }: { color: string; text: string }) => (
  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
    <span style={{ width: 10, height: 10, borderRadius: 2, background: color }} />
    {text}
  </span>
);

const Message = ({ text }: { text: string }) => (
  <div style={{ height: '100%', display: 'grid', placeItems: 'center', opacity: 0.75, fontFamily: 'IBM Plex Sans, system-ui, sans-serif' }}>{text}</div>
);

export const paymentHeatmap: HeatmapDefinition = {
  id: 'payment-heatmap',
  label: 'Payment rhythm',
  icon: { url: GRID_ICON },
  dataMapping: {
    row: { type: 'field', supportedRoles: ['category'], requires: { cardinality: 'one' }, required: true, aiDescription: 'Who: usually the student or family' },
    column: { type: 'field', supportedRoles: ['category', 'temporal'], requires: { cardinality: 'one' }, required: true, aiDescription: 'When: usually the billed month' },
    value: { type: 'field', supportedRoles: ['numeric'], requires: { cardinality: 'one' }, required: true, aiDescription: 'Days it took to pay (average)' },
  },
  form: (params) =>
    params.createDefaults({
      dataMappingItems: [
        { key: 'row', label: 'Rows' },
        { key: 'column', label: 'Columns' },
        { key: 'value', label: 'Days to pay' },
      ],
    }),
  comp: PaymentHeatmap,
  defaultSize: { width: 640, height: 360 },
  minSize: { width: 320, height: 200 },
  ai: { description: 'Heatmap of how quickly each family pays each month: green is on time, amber late, red very late or still open.' },
};
