async function debug() {
  const eps = [
    '/hudmsg?lastEvt=0&lastDmg=0',
    '/hudmsg?lastEvt=-1&lastDmg=-1',
    '/gamechat?lastId=0',
    '/gamechat?lastId=-1'
  ];
  for (const ep of eps) {
    try {
      const res = await fetch('http://localhost:8111' + ep);
      if (res.ok) {
        const text = await res.text();
        console.log(`Endpoint ${ep} exists!`);
        console.log(text.slice(0, 1000));
      } else {
        console.log(`Endpoint ${ep} returned status: ${res.status}`);
      }
    } catch (e) {
      console.log(`Endpoint ${ep} error: ${e.message}`);
    }
  }
}

debug();
