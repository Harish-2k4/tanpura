// AG Studio data sources for Tanpura: families, invoices (with payment timing) and classes,
// joined to families and placed on one calendar.
import type { AgDataSourcesDefinition, AgFieldDefinition, AgFormat, AgRelationDefinition } from 'ag-studio';
import type { UiWords } from '../../../hooks/useWords';
import type { TanpuraRegistry } from './heatmap';
import type { DashboardData } from '../../../../../shared/api';

const CALENDAR = 'calendar';

type FieldSpec = [id: string, name: string, format: AgFormat, hide?: boolean];
const fields = (specs: FieldSpec[]): AgFieldDefinition[] => specs.map(([id, name, format, hide]) => ({ id, name, format, ...(hide && { hide }) }));

const toFamily = (id: string, table: string): AgRelationDefinition => ({
  id,
  source: { tableId: table, fieldId: 'familyId' },
  target: { tableId: 'families', fieldId: 'id' },
  type: 'many-to-one',
});

const onCalendar = (tableId: string, fieldId: string): AgRelationDefinition => ({
  id: `${tableId}-${fieldId}-calendar`,
  source: { tableId, fieldId },
  target: { calendarId: CALENDAR },
});

export function buildStudioData(data: DashboardData, w: UiWords): AgDataSourcesDefinition<TanpuraRegistry> {
  const dates = [...data.invoices.map((i) => i.month), ...data.classes.map((c) => c.date)].sort();
  const today = data.asOf.slice(0, 10);
  return {
    description:
      `${w.who.charAt(0).toUpperCase()}${w.who.slice(1)} in India bills ${w.families} abroad for monthly ${w.classes} through PayPal invoices. ` +
      `Each ${w.family} pays in its own currency (for example USD, GBP or AUD); money is never converted, so filter to one currency before summing money. "${w.Families}" are the families table and "${w.classes}" the classes table.`,
    sources: [
      {
        id: 'families',
        description: `One row per ${w.student} and who pays.`,
        data: data.families,
        fields: fields([
          ['id', `${w.Family} ID`, 'textFormat', true],
          ['student', w.Student, 'textFormat'],
          ['parent', w.Parent, 'textFormat'],
          ['country', 'Country', 'textFormat'],
          ['currency', 'Currency', 'textFormat'],
          ['rate', `Rate per ${w.Class}`, 'currencyFormat'],
        ]),
      },
      {
        id: 'invoices',
        description: 'One row per PayPal invoice (cancelled ones left out). Days to Pay counts to today for invoices still open.',
        data: data.invoices,
        fields: fields([
          ['id', 'Invoice ID', 'textFormat', true],
          ['familyId', 'Family ID', 'textFormat', true],
          ['month', 'Billed Month', 'dateFormat'],
          ['issued', 'Issued', 'dateFormat'],
          ['due', 'Due', 'dateFormat'],
          ['paid', 'Paid On', 'dateFormat'],
          ['state', 'Invoice State', 'textFormat'],
          ['currency', 'Currency', 'textFormat'],
          ['billed', 'Billed', 'currencyFormat'],
          ['collected', 'Collected', 'currencyFormat'],
          ['outstanding', 'Outstanding', 'currencyFormat'],
          ['overdue', 'Overdue', 'currencyFormat'],
          ['daysToPay', 'Days to Pay', 'integerFormat'],
          ['isPaid', 'Is Paid', 'booleanFormat'],
        ]),
      },
      {
        id: 'classes',
        description: `One row per ${w.class}, including ${w.makeups}, with what happened to it.`,
        data: data.classes,
        fields: fields([
          ['id', `${w.Class} ID`, 'textFormat', true],
          ['familyId', 'Family ID', 'textFormat', true],
          ['date', `${w.Class} Date`, 'dateFormat'],
          ['outcome', 'Outcome', 'textFormat'],
          ['isMakeup', `Is ${w.Makeup}`, 'booleanFormat'],
          ['minutes', 'Minutes', 'integerFormat'],
        ]),
      },
    ],
    relationships: [toFamily('invoice-family', 'invoices'), toFamily('class-family', 'classes'), onCalendar('invoices', 'month'), onCalendar('classes', 'date')],
    calendars: [
      {
        id: CALENDAR,
        label: 'Calendar',
        range: { from: { type: 'date', value: dates[0] ?? today }, to: { type: 'date', value: dates.at(-1) ?? today } },
        fragments: ['year', 'quarter', 'month', 'week', 'day', 'dayOfWeek'],
      },
    ],
    expressions: [
      {
        id: 'collectionRate',
        name: 'Collection Rate',
        description: 'Collected / billed. Filter to one currency first.',
        format: 'percentageFormat',
        isMeasure: true,
        expression: { operator: 'divide', inputs: [{ id: 'invoices.collected', aggregation: 'sum' }, { id: 'invoices.billed', aggregation: 'sum' }] },
      },
    ],
  };
}
