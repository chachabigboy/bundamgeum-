export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const { sigunguCd, bjdongCd, bun, ji } = req.query;

  if (!sigunguCd || !bjdongCd || !bun) {
    return res.status(400).json({ error: '파라미터 누락' });
  }

  const KEY = '9470763e33c0df8c9dfa6af03edbfbece3ac2adb4818385cbe32c2368b974ad5';
  const jiVal = ji || '0000';

  const url =
    `https://apis.
