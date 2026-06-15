/**
 * Details Transaction form pattern.
 * https://learn.microsoft.com/en-us/dynamics365/fin-ops-core/dev-itpro/user-interface/details-transaction-form-pattern
 */

import type { FormPatternSpec, NodeSpec } from '../../types.js';
import { actionPane, filterGroup } from './common.js';

const headerLinesTabs: NodeSpec = {
  id: 'HeaderLinesTabs',
  controlTypes: ['Tab'],
  occurrence: 'required',
  nameHint: 'Tab',
  properties: { Style: 'FastTabs' },
  children: [
    {
      id: 'HeaderOrLinesPage',
      controlTypes: ['TabPage'],
      occurrence: 'oneOrMore',
      // Header pages follow field sub-patterns; the Lines page holds
      // ActionPaneTab + Grid and typically has no sub-pattern.
      requiresSubPattern: false,
      extraChildren: 'any',
    },
  ],
  extraChildren: 'none',
};

export const detailsTransaction: FormPatternSpec = {
  id: 'DetailsTransaction',
  xmlName: 'DetailsTransaction',
  displayName: 'Details Transaction',
  versions: ['1.4', '1.1', '1.0'],
  purpose:
    'Displays the details of a complex transaction entity and its lines — an order header plus ' +
    'order lines (e.g. sales orders, purchase orders).',
  whenToUse: [
    'Header + lines transaction entity (order/journal with line items)',
    'Two related datasources: header table and lines table',
    'Users need both a header view and a line-editing grid',
  ],
  whenNotToUse: [
    'Master entity without lines → Details Master',
    'Simple journal-style entry → consider Task patterns only for migrations',
  ],
  referenceForms: ['SalesTable', 'PurchTable', 'ProjInvoiceJournal'],
  designProperties: { Style: 'DetailsFormTransaction' },
  requiresDataSource: 'headerLines',
  root: [actionPane('required'), filterGroup('optional'), headerLinesTabs],
  extraRootChildren: 'none',
  lifecycleGuidance: [
    'Link the lines datasource to the header datasource (JoinSource + Active link type).',
    'Override the lines datasource initValue() to default line fields from the header.',
    'Override the header datasource active() to refresh totals/line state.',
  ],
};
