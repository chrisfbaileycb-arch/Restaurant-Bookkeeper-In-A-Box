/**
 * Operational Legal Layer — enforced informed consent at high-stakes
 * interaction points. High-stakes endpoints REFUSE to act (HTTP 428) until
 * the caller explicitly acknowledges the agentic-nature disclaimer by
 * echoing the ack token. UIs render the disclaimer text and send the ack
 * header on confirm. Ported from @expo-proxy/shared disclaimers.ts.
 */

export const DISCLAIMER_VERSION = 'agentic-disclaimer-v1';
export const ACK_HEADER = 'x-expoproxy-ack';

const BASE_LIABILITY =
  'This operation is executed by an autonomous software agent. Outcomes are ' +
  'produced algorithmically from the data and configuration you provide and are ' +
  'not individually reviewed by a human before execution. To the maximum extent ' +
  'permitted by law, liability is limited to the fees paid for the service; the ' +
  'operator remains responsible for verifying results before relying on them.';

export const DISCLAIMERS = {
  data_export: {
    id: DISCLAIMER_VERSION,
    action: 'data_export',
    title: 'Automated data export',
    text:
      'You are exporting business records assembled by an autonomous pipeline. ' +
      'Verify totals against your POS before filing or accounting use. ' +
      BASE_LIABILITY,
  },
  manual_import: {
    id: DISCLAIMER_VERSION,
    action: 'manual_import',
    title: 'Manual data import',
    text:
      'You are importing POS data into the persistent store. You confirm you ' +
      'have personally reviewed this file; downstream agents will treat it as ' +
      'authoritative business truth. The file is sanitized and strictly ' +
      'validated, but data accuracy remains your responsibility. ' +
      BASE_LIABILITY,
  },
  ap_import: {
    id: DISCLAIMER_VERSION,
    action: 'ap_import',
    title: 'Vendor invoice import',
    text:
      'You are registering supplier invoices in the AP subledger and posting ' +
      'them to the ledger. Line categorization is rule-based on the category ' +
      'field; review the routed accounts before relying on COGS reports. ' +
      BASE_LIABILITY,
  },
  inventory_count: {
    id: DISCLAIMER_VERSION,
    action: 'inventory_count',
    title: 'Inventory count adjustment',
    text:
      'You are posting a physical inventory count. The variance between the ' +
      'ledger and your count posts to COGS adjustment accounts — a wrong ' +
      'count directly changes reported food and beverage costs. Recount ' +
      'before submitting if the variance looks large. ' +
      BASE_LIABILITY,
  },
  pos_summary: {
    id: DISCLAIMER_VERSION,
    action: 'pos_summary',
    title: 'POS daily summary import',
    text:
      'You are posting daily sales summaries with category splits taken from ' +
      'your POS export. Verify the export covers the full day and that cash ' +
      'drop amounts match your safe counts. ' +
      BASE_LIABILITY,
  },
  bank_import: {
    id: DISCLAIMER_VERSION,
    action: 'bank_import',
    title: 'Bank statement import',
    text:
      'You are importing bank statement activity. Deposits are auto-matched ' +
      'to clearing accounts by description rules and posted; rows the rules ' +
      'cannot identify are parked unmatched and never posted. Review the ' +
      'unmatched queue after import. ' +
      BASE_LIABILITY,
  },
  delivery_import: {
    id: DISCLAIMER_VERSION,
    action: 'delivery_import',
    title: 'Delivery statement import',
    text:
      'You are recording third-party delivery payout statements. Figures ' +
      'must match the platform’s own statement; the reconciliation identity ' +
      '(payout = gross − commissions − marketing − refunds) is enforced, but ' +
      'source accuracy remains your responsibility. ' +
      BASE_LIABILITY,
  },
  payroll_import: {
    id: DISCLAIMER_VERSION,
    action: 'payroll_import',
    title: 'Payroll journal import',
    text:
      'You are recording payroll that was EXECUTED by your third-party ' +
      'payroll service. This system does not run payroll and does not move ' +
      'money — it records the journal from your provider’s reports. Verify ' +
      'the figures against the provider’s pay-run summary before importing. ' +
      BASE_LIABILITY,
  },
  ap_payment: {
    id: DISCLAIMER_VERSION,
    action: 'ap_payment',
    title: 'Record invoice payment',
    text:
      'You are recording a vendor payment in your books. This system does NOT ' +
      'move money — it records a payment you have already made (or are making) ' +
      'through your bank or by check. Confirm the payment actually occurred. ' +
      BASE_LIABILITY,
  },
};

/** The exact ack value a caller must send to consent to an action. */
export function ackToken(action) {
  return DISCLAIMER_VERSION + ':' + action;
}

/**
 * Gate a handler on the disclaimer ack header. Returns true when the caller
 * consented; otherwise sends 428 Precondition Required with the full
 * disclaimer payload (so every client can render the exact text and
 * re-submit with consent) and returns false.
 */
export function requireAck(action, req, res) {
  if (req.headers[ACK_HEADER] === ackToken(action)) return true;
  res.status(428).json({
    error: 'disclaimer_acknowledgement_required',
    disclaimer: DISCLAIMERS[action],
    requiredAckHeader: ACK_HEADER,
    requiredAckValue: ackToken(action),
  });
  return false;
}
