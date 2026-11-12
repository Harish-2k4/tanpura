// The dashboard's built-in report, as AG Studio state. Field ids ('invoices.billed') refer to the
// data sources in ./data.ts; 'payment-heatmap' is the custom widget in ./heatmap.tsx.
import type { AgPageState, AgReportState, AgWidgetLayoutState } from 'ag-studio';
import type { UiWords } from '../../../hooks/useWords';
import type { TanpuraRegistry } from './heatmap';

// Position on the canvas grid, in tracks: 24 columns wide.
const at = (xTrack: number, yTrack: number, xSpan: number, ySpan: number): AgWidgetLayoutState => ({ xTrack, yTrack, xSpan, ySpan });
const title = (text: string) => ({ title: { enabled: true, text } });
const sum = (id: string) => ({ id, aggregation: 'sum' as const });
const avg = (id: string) => ({ id, aggregation: 'avg' as const });
const countd = (id: string) => ({ id, aggregation: 'countd' as const });

const kpi = (text: string, value: { id: string; aggregation?: 'sum' | 'avg' | 'countd' }) => ({
  type: 'value' as const,
  dataMapping: { value: [value] },
  format: { title: { enabled: true, text } },
});

// Built with the user's words (students or clients, classes or sessions).
export function buildDashboardReport(w: UiWords): AgReportState<TanpuraRegistry> {
// Money is never converted, so the money page is driven by a single-select currency switch.
const money: AgPageState<TanpuraRegistry> = {
  id: 'money',
  widgets: {
    currency: {
      type: 'button-filter',
      dataMapping: { value: [{ id: 'invoices.currency' }] },
      format: { ...title('Currency'), style: { selection: { type: 'single' } } },
    },
    'kpi-billed': kpi('Billed', sum('invoices.billed')),
    'kpi-collected': kpi('Collected', sum('invoices.collected')),
    'kpi-outstanding': kpi('Outstanding', sum('invoices.outstanding')),
    'kpi-overdue': kpi('Overdue', sum('invoices.overdue')),
    'billed-vs-collected': {
      type: 'combo-chart-grouped-column-line',
      dataMapping: {
        categoryKey: [{ id: 'calendar::month' }],
        valueKey: [sum('invoices.billed'), sum('invoices.collected')],
        secondaryValueKey: [{ id: 'collectionRate' }],
      },
      format: { ...title('Billed and collected by month, with collection rate'), style: { theme: { common: { legend: { enabled: true } } } } },
    },
    rhythm: {
      type: 'payment-heatmap',
      dataMapping: { row: [{ id: 'families.student' }], column: [{ id: 'invoices.month' }], value: [avg('invoices.daysToPay')] },
      format: title('Payment rhythm: days to pay each month'),
    },
  },
  widgetLayout: {
    'kpi-billed': at(0, 0, 4, 9),
    'kpi-collected': at(4, 0, 4, 9),
    'kpi-outstanding': at(8, 0, 4, 9),
    'kpi-overdue': at(12, 0, 4, 9),
    currency: at(16, 0, 8, 9),
    'billed-vs-collected': at(0, 9, 24, 16),
    rhythm: at(0, 25, 24, 26),
  },
  filter: {
    page: [{ field: { id: 'invoices.currency' }, model: { operator: 'isIn', value: ['USD'] }, filterWidgetId: 'currency' }],
  },
};

const families: AgPageState<TanpuraRegistry> = {
  id: 'families',
  widgets: {
    'by-state': {
      type: 'donut-chart',
      dataMapping: { categoryKey: [{ id: 'invoices.state' }], valueKey: [countd('invoices.id')] },
      format: title('Invoices by state'),
    },
    'days-to-pay': {
      type: 'bar-chart-grouped',
      dataMapping: { categoryKey: [{ id: 'families.student' }], valueKey: [avg('invoices.daysToPay')] },
      sort: [{ field: avg('invoices.daysToPay'), direction: 'desc' }],
      format: title(`Average days to pay, by ${w.family}`),
    },
    table: {
      type: 'grid',
      dataMapping: {
        cols: [
          { id: 'families.student' },
          { id: 'families.parent' },
          { id: 'families.country' },
          { id: 'families.currency' },
          sum('invoices.billed'),
          sum('invoices.collected'),
          sum('invoices.outstanding'),
          avg('invoices.daysToPay'),
        ],
      },
      sort: [{ field: sum('invoices.outstanding'), direction: 'desc' }],
      format: title(`${w.Families} (amounts in each ${w.family}'s own currency)`),
    },
  },
  widgetLayout: {
    'by-state': at(0, 0, 8, 18),
    'days-to-pay': at(8, 0, 16, 18),
    table: at(0, 18, 24, 22),
  },
};

const classes: AgPageState<TanpuraRegistry> = {
  id: 'classes',
  widgets: {
    'kpi-classes': kpi(w.Classes, countd('classes.id')),
    'kpi-minutes': kpi(`${w.Class} minutes`, sum('classes.minutes')),
    'by-month': {
      type: 'column-chart-stacked',
      dataMapping: { categoryKey: [{ id: 'calendar::month' }], valueKey: [countd('classes.id')], legendKey: [{ id: 'classes.outcome' }] },
      format: { ...title(`${w.Classes} by month and outcome`), style: { theme: { common: { legend: { enabled: true } } } } },
    },
    outcome: {
      type: 'donut-chart',
      dataMapping: { categoryKey: [{ id: 'classes.outcome' }], valueKey: [countd('classes.id')] },
      format: title(`What happened to ${w.classes}`),
    },
    makeups: {
      type: 'bar-chart-grouped',
      dataMapping: { categoryKey: [{ id: 'families.student' }], valueKey: [countd('classes.id')], legendKey: [{ id: 'classes.isMakeup' }] },
      format: title(`${w.Classes} and ${w.makeups} by ${w.student}`),
    },
  },
  widgetLayout: {
    'kpi-classes': at(0, 0, 6, 7),
    'kpi-minutes': at(6, 0, 6, 7),
    outcome: at(12, 0, 12, 20),
    'by-month': at(0, 7, 12, 20),
    makeups: at(0, 27, 24, 20),
  },
};

return { selectedPageId: money.id, pages: [money, families, classes] };
}

export const pageTitles = (w: UiWords): Record<string, string> => ({ money: 'Money', families: w.Families, classes: w.Classes });
