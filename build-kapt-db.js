// 이 스크립트를 로컬에서 한 번 실행해서 kapt-db.json 생성
// node api/build-kapt-db.js

const KEY  = '9470763e33c0df8c9dfa6af03edbfbece3ac2adb4818385cbe32c2368b974ad5';
const BASE = 'https://apis.data.go.kr/1613000/AptListService3/getTotalAptList3';
const fs   = require('fs');

async function fetchPage(page) {
  const url = `${BASE}?serviceKey=${KEY}&_type=json&numOfRows=1000&pageNo=${page}`;
  const r   = await fetch(url);
  const d   = await r.json();
  return {
    total: d?.response?.body?.totalCount || 0,
    items: d?.response?.body?.items?.item || [],
  };
}

async function main() {
  console.log('전국 단지 목록 수집 시작...');
  const { total, items: first } = await fetchPage(1);
  console.log(`총 ${total}개 단지`);

  const all = [...(Array.isArray(first) ? first : [first])];
  const pages = Math.ceil(total / 1000);

  for (let p = 2; p <= pages; p++) {
    console.log(`페이지 ${p}/${pages}...`);
    const { items } = await fetchPage(p);
    all.push(...(Array.isArray(items) ? items : [items]));
    await new Promise(r => setTimeout(r, 200)); // rate limit
  }

  // kaptCode, kaptName, kaptAddr, bjdCode만 저장 (용량 최소화)
  const db = all
    .filter(i => i?.kaptCode)
    .map(i => ({
      c: i.kaptCode,                          // kaptCode
      n: i.kaptName,                          // 단지명
      a: i.kaptAddr || '',                    // 주소
      b: i.bjdCode  || '',                    // 법정동코드
    }));

  fs.writeFileSync('./kapt-db.json', JSON.stringify(db));
  console.log(`완료! ${db.length}개 단지 저장 → kapt-db.json`);
}

main().catch(console.error);
