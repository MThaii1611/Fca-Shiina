'use strict';

const axios = require('axios');

async function getUIDFromLookup(url) {
  try {
    const res = await axios.post(
      'https://lookup-id.com/',
      new URLSearchParams({
        fburl: url,
        check: 'Lookup'
      }).toString(),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
          'Origin': 'https://lookup-id.com',
          'Referer': 'https://lookup-id.com/'
        },
        timeout: 15000
      }
    );
    const html = typeof res.data === 'string' ? res.data : String(res.data || '');
    const m = html.match(/<span id=["']code["']>(\d+)<\/span>/i);
    if (m && m[1]) return String(m[1]);
  } catch (_) {}
  return null;
}

async function getUID(url, api) {
  try {
    const str = String(url || '').trim();
    if (!str) return null;

    // 1. Nếu đã là dãy số UID thuần túy
    if (/^\d+$/.test(str)) return str;

    // 2. Nhận diện trực tiếp qua URL patterns
    const idMatch =
      str.match(/[?&]id=(\d+)/i) ||
      str.match(/profile\.php\?id=(\d+)/i) ||
      str.match(/facebook\.com\/(\d+)(?:[/?#]|$)/i) ||
      str.match(/fb\.com\/(\d+)(?:[/?#]|$)/i);
    if (idMatch && idMatch[1]) return String(idMatch[1]);

    // 3. Chuẩn hóa link đầy đủ
    let fullUrl = str;
    if (!fullUrl.startsWith('http://') && !fullUrl.startsWith('https://')) {
      fullUrl = 'https://www.facebook.com/' + fullUrl.replace(/^\/+/, '');
    }

    // 4. Tra cứu qua lookup-id.com
    const lookupRes = await getUIDFromLookup(fullUrl);
    if (lookupRes && !isNaN(lookupRes)) return String(lookupRes);

    return null;
  } catch (_) {
    return null;
  }
}

module.exports = getUID;