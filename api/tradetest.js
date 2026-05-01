export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const KEY   = '9470763e33c0df8c9dfa6af03edbfbece3ac2adb4818385cbe32c2368b974ad5';
  const TRADE = 'https://apis.data.go.kr/1613000/RTMSDataSvcAptTradeDev/getRTMSDataSvcAptTradeDev';

  // 도로명 + 번지로 매칭 테스트
  // 묘향롯데: 경기도 군포시 고산로539번길 7-12
  // → roadNm=고산로539번길, bonbun=00007
  const { sgg, road, bonbun } = req.query;
  // 기본값: 묘향롯데
  const LAWD  = sgg    || '41410';
  const ROAD  = road   || '고산로539번길';
  const BON   = bonbun || '7';

  const months = ['202503','202502','202501','202412','202411'];
  const results = await Promise.allSettled(
    months.map(ym =>
      fetch(`${TRADE}?serviceKey=${KEY}&LAWD_CD=${LAWD}&DEAL_YMD=${ym}&numOfRows=1000`)
        .then(r => r.text())
    )
  );

  const areaCount = {};
  let matchCount = 0;

  results.forEach(r => {
    if (r.status !== 'fulfilled') return;
    const xml = r.value;
    const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)];

    items.forEach(m => {
      const block = m[1];
      const roadMatch = block.match(/<roadNm>([^<]+)<\/roadNm>/);
      const bonMatch  = block.match(/<roadNmBonbun>(\d+)<\/roadNmBonbun>/);
      if (!roadMatch || !bonMatch) return;

      const roadNm  = roadMatch[1].trim();
      const bonNum  = parseInt(bonMatch[1], 10);

      // 도로명 + 번지 매칭
      if (!roadNm.includes(ROAD) && !ROAD.includes(roadNm)) return;
      if (BON && parseInt(BON) !== bonNum) return;

      const areaMatch = block.match(/<excluUseAr>([\d.]+)<\/excluUseAr>/);
      const nameMatch = block.match(/<aptNm>([^<]+)<\/aptNm>/);
      if (!areaMatch) return;

      const area = Math.round(parseFloat(areaMatch[1]) * 100) / 100;
      if (area > 0) {
        areaCount[area] = (areaCount[area] || 0) + 1;
        matchCount++;
      }
    });
  });

  return res.status(200).json({
    matched: matchCount,
    types: Object.entries(areaCount)
      .map(([a,c]) => ({ area: parseFloat(a), pyeong: Math.round(parseFloat(a)/3.3058), count: c }))
      .sort((a,b) => a.area - b.area)
  });
}
