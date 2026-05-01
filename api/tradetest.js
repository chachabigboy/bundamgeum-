export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const KEY   = '9470763e33c0df8c9dfa6af03edbfbece3ac2adb4818385cbe32c2368b974ad5';
  const TRADE = 'https://apis.data.go.kr/1613000/RTMSDataSvcAptTradeDev/getRTMSDataSvcAptTradeDev';

  // 군포시 최근 3개월 병렬 조회 → 단지명 목록 추출
  const months = ['202503','202502','202501'];
  const results = await Promise.allSettled(
    months.map(ym =>
      fetch(`${TRADE}?serviceKey=${KEY}&LAWD_CD=41410&DEAL_YMD=${ym}&numOfRows=1000`)
        .then(r => r.text())
    )
  );

  const nameSet = new Set();
  results.forEach(r => {
    if (r.status !== 'fulfilled') return;
    const xml = r.value;
    [...xml.matchAll(/<aptNm>([^<]+)<\/aptNm>/g)].forEach(m => nameSet.add(m[1].trim()));
  });

  // 묘향 포함된 이름만 필터
  const myohyang = [...nameSet].filter(n => n.includes('묘향'));
  // 롯데 포함된 이름
  const lotte    = [...nameSet].filter(n => n.includes('롯데'));

  return res.status(200).json({
    myohyang,
    lotte,
    totalUniqueNames: nameSet.size,
    sample: [...nameSet].slice(0, 20)
  });
}
