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
