export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const KEY   = '9470763e33c0df8c9dfa6af03edbfbece3ac2adb4818385cbe32c2368b974ad5';
  const TRADE = 'https://apis.data.go.kr/1613000/RTMSDataSvcAptTradeDev/getRTMSDataSvcAptTradeDev';

  // XML 형식으로 요청 (JSON 지원 안 함)
  const url = `${TRADE}?serviceKey=${KEY}&LAWD_CD=41410&DEAL_YMD=202412&numOfRows=10`;
  try {
    const r   = await fetch(url);
    const txt = await r.text();
    // XML에서 아파트명, 전용면적 패턴 추출
    const items = [...txt.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0,3).map(m => m[1]);
    return res.status(200).json({ status: r.status, preview: txt.slice(0,300), items });
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}
