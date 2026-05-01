export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const KEY   = '9470763e33c0df8c9dfa6af03edbfbece3ac2adb4818385cbe32c2368b974ad5';
  const TRADE = 'https://apis.data.go.kr/1613000/RTMSDataSvcAptTradeDev/getRTMSDataSvcAptTradeDev';

  const { sgg, road, bonbun } = req.query;
  const LAWD = sgg    || '41410';
  const ROAD = road   || '고산로539번길';
  const BON  = bonbun || '7';

  // 최근 36개월 병렬 조회
  const now = new Date();
  const months = Array.from({length: 36}, (_,i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    return `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}`;
  });

  const results = await Promise.allSettled(
    months.map(ym =>
      fetch(`${TRADE}?serviceKey=${KEY}&LAWD_CD=${LAWD}&DEAL_YMD=${ym}&numOfRows=1000`)
        .then(r => r.text())
    )
  );

  const areaCount = {};
  results.forEach(r => {
    if (r.status !== 'fulfilled') return;
    [...r.value.matchAll(/<item>([\s\S]*?)<\/item>/g)].forEach(m => {
      const block = m[1];
      const roadNm = block.match(/<roadNm>([^<]+)<\/roadNm>/)?.[1]?.trim() || '';
      const bonNum = parseInt(block.match(/<roadNmBonbun>(\d+)<\/roadNmBonbun>/)?.[1] || '0');
      if (!roadNm.includes(ROAD) && !ROAD.includes(roadNm)) return;
      if (BON && parseInt(BON) !== bonNum) return;
      const area = Math.round(parseFloat(block.match(/<excluUseAr>([\d.]+)<\/excluUseAr>/)?.[1] || 0) * 100) / 100;
      if (area > 0) areaCount[area] = (areaCount[area] || 0) + 1;
    });
  });

  return res.status(200).json({
    months: months.length,
    types: Object.entries(areaCount)
      .map(([a,c]) => ({ area: parseFloat(a), pyeong: Math.round(parseFloat(a)/3.3058), count: c }))
      .sort((a,b) => a.area - b.area)
  });
}
