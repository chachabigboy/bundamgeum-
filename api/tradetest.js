export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const KEY   = '9470763e33c0df8c9dfa6af03edbfbece3ac2adb4818385cbe32c2368b974ad5';
  const TRADE = 'https://apis.data.go.kr/1613000/RTMSDataSvcAptTradeDev/getRTMSDataSvcAptTradeDev';

  const { sgg, road } = req.query;
  const LAWD = sgg  || '41410';
  const ROAD = road || '고산로539번길';

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

  // 도로명 매칭 단지명 + 전용면적 모두 수집
  const nameAreaMap = {}; // { 단지명: Set(면적들) }

  results.forEach(r => {
    if (r.status !== 'fulfilled') return;
    [...r.value.matchAll(/<item>([\s\S]*?)<\/item>/g)].forEach(m => {
      const block = m[1];
      const roadNm = block.match(/<roadNm>([^<]+)<\/roadNm>/)?.[1]?.trim() || '';
      if (!roadNm.includes(ROAD) && !ROAD.includes(roadNm)) return;

      const aptNm = block.match(/<aptNm>([^<]+)<\/aptNm>/)?.[1]?.trim() || '';
      const area  = Math.round(parseFloat(block.match(/<excluUseAr>([\d.]+)<\/excluUseAr>/)?.[1] || 0) * 100) / 100;

      if (!nameAreaMap[aptNm]) nameAreaMap[aptNm] = new Set();
      if (area > 0) nameAreaMap[aptNm].add(area);
    });
  });

  return res.status(200).json({
    complexes: Object.entries(nameAreaMap).map(([name, areas]) => ({
      name,
      areas: [...areas].sort((a,b) => a-b),
      pyeongs: [...areas].sort((a,b) => a-b).map(a => Math.round(a/3.3058))
    }))
  });
}
