// Public liveness probe — mirrors GET /health on the original service.
export const access = 'public';
export const methods = ['GET'];

export default async function (req, res) {
  return res.json({ ok: true });
}
