'use strict';

const logger = require('../logger');

/**
 * Trích xuất fb_dtsg từ HTML
 * @param {string} html 
 * @returns {string|null}
 */
function getFBDTSG(html) {
    if (!html || typeof html !== 'string') return null;

    let match = html.match(/\["DTSGInitialData",\[\],{"token":"([^"]+)"}/);
    if (match) return match[1].replace(/\\/g, '');

    match = html.match(/\["DTSGInitData",\[\],{"token":"([^"]+)"/);
    if (match) {
        logger.Normal("Found fb_dtsg in DTSGInitData pattern");
        return match[1].replace(/\\/g, '');
    }

    match = html.match(/{"token":"([^"]+)","async_get_token"/);
    if (match) {
        logger.Normal("Found fb_dtsg in async_get_token pattern");
        return match[1];
    }

    match = html.match(/<input type="hidden" name="fb_dtsg" value="([^"]+)"/);
    if (match) {
        logger.Normal("Found fb_dtsg in input field pattern");
        return match[1];
    }

    match = html.match(/\["",\[\],{"token":"([^"]+:\d+:\d+)"}/);
    if (match) {
        logger.Normal("Found fb_dtsg in empty-module-name pattern");
        return match[1].replace(/\\/g, '');
    }

    match = html.match(/"DTSGInitialData"[^>]*?"token":"([^"]+)"/);
    if (match) return match[1].replace(/\\/g, '');

    match = html.match(/"dtsg":\{"token":"([^"]+)"/);
    if (match) return match[1].replace(/\\/g, '');

    match = html.match(/DTSG[^"]*"token":"([^"]+)"/);
    if (match) return match[1].replace(/\\/g, '');

    return null;
}

/**
 * Trích xuất jazoest từ HTML
 * @param {string} html 
 * @returns {string|null}
 */
function getJazoest(html) {
    if (!html || typeof html !== 'string') return null;
    let match = html.match(/name="jazoest" value="([^"]+)"/);
    if (match) return match[1];
    match = html.match(/jazoest=([0-9]+)/);
    return match ? match[1] : null;
}

/**
 * Trích xuất lsd từ HTML
 * @param {string} html 
 * @returns {string|null}
 */
function getLsd(html) {
    if (!html || typeof html !== 'string') return null;
    let match = html.match(/\["LSD",\[\],{"token":"([^"]+)"}/);
    if (match) return match[1];
    match = html.match(/name="lsd" value="([^"]+)"/);
    return match ? match[1] : null;
}

/**
 * Trích xuất irisSeqID từ HTML
 * @param {string} html 
 * @returns {string|null}
 */
function getIrisSeqID(html) {
    if (!html || typeof html !== 'string') return null;
    const match = html.match(/irisSeqID":"([^"]+)"/);
    return match ? match[1] : null;
}

/**
 * Trích xuất endpoint MQTT từ HTML
 * @param {string} html 
 * @returns {string|null}
 */
function getMqttEndpoint(html) {
    if (!html || typeof html !== 'string') return null;
    let endpoint = (html.match(/"endpoint":"([^"]+)"/) || [])[1];
    if (endpoint) {
        endpoint = endpoint.replace(/\\\//g, '/');
        if (!endpoint.startsWith('wss://') && !endpoint.startsWith('ws://')) {
            endpoint = endpoint.replace(/^https?:\/\//i, 'wss://');
            if (!endpoint.startsWith('wss://')) endpoint = 'wss://' + endpoint;
        }
        return endpoint;
    }
    return null;
}

/**
 * Thử lấy fb_dtsg qua các endpoint dự phòng khi trang chính thiếu
 * @param {object} jar 
 * @param {object} globalOptions 
 * @returns {{ fb_dtsg: string|null, jazoest: string|null, lsd: string|null }}
 */
async function fetchFallbackTokens(jar, globalOptions) {
    const fallbackUrls = [
        'https://www.facebook.com/',
        'https://m.facebook.com/'
    ];
    let fb_dtsg = null;
    let jazoest = null;
    let lsd = null;

    for (const fbUrl of fallbackUrls) {
        try {
            const res = await global.Fca.Require.Fetch(fbUrl, {
                headers: {
                    Cookie: jar.getCookies('https://www.facebook.com').join('; '),
                    'User-Agent': globalOptions.userAgent,
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
                    'Sec-Ch-Ua': '"Chromium";v="129", "Not=A?Brand";v="24", "Google Chrome";v="129"',
                    'Sec-Ch-Ua-Mobile': '?0',
                    'Sec-Ch-Ua-Platform': '"Windows"',
                    'Sec-Fetch-Dest': 'document',
                    'Sec-Fetch-Mode': 'navigate',
                    'Sec-Fetch-Site': 'none',
                    'Sec-Fetch-User': '?1',
                    'Upgrade-Insecure-Requests': '1'
                },
                timeout: 8000
            });
            const fallbackHtml = res.body;

            fb_dtsg = getFBDTSG(fallbackHtml);
            if (!jazoest) jazoest = getJazoest(fallbackHtml);
            if (!lsd) lsd = getLsd(fallbackHtml);
            if (fb_dtsg) {
                logger.Normal("Đã lấy fb_dtsg qua nguồn dự phòng: " + fbUrl);
                break;
            }
        } catch (_) {}
    }

    return { fb_dtsg, jazoest, lsd };
}

module.exports = {
    getFBDTSG,
    getJazoest,
    getLsd,
    getIrisSeqID,
    getMqttEndpoint,
    fetchFallbackTokens
};
