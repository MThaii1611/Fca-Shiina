"use strict";
/**
 * login/http-client.js
 * HTTP client để gọi Facebook, giữ cookie jar tự động, bám sát header và redirect của fca-shiina-lightspeed
 * Sử dụng https.Agent family: 4 (IPv4) để tránh lỗi 400 Bad Request / http_request_error của Meta proxy
 */

const http = require("http");
const https = require("https");
const axios = require("axios");
const { saveCookies } = require("./jar-builder");

const DEFAULT_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36";
const DEFAULT_UA_MAJOR = "133";

const httpAgent = new http.Agent({ family: 4, keepAlive: true });
const httpsAgent = new https.Agent({ family: 4, keepAlive: true });

function getNavHeaders(urlStr, ua) {
    let host = "www.facebook.com";
    try { host = new URL(urlStr).hostname; } catch (_) {}
    const match = (ua || DEFAULT_UA).match(/Chrome\/(\d+)/);
    const major = match ? match[1] : DEFAULT_UA_MAJOR;

    return {
        "Host": host,
        "Connection": "keep-alive",
        "Cache-Control": "max-age=0",
        "sec-ch-ua": `"Chromium";v="${major}", "Google Chrome";v="${major}", "Not.A/Brand";v="24"`,
        "sec-ch-ua-mobile": "?0",
        "sec-ch-ua-platform": '"Windows"',
        "Upgrade-Insecure-Requests": "1",
        "User-Agent": ua || DEFAULT_UA,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
        "Sec-Fetch-Site": "none",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-User": "?1",
        "Sec-Fetch-Dest": "document",
        "Accept-Encoding": "gzip, deflate",
        "Accept-Language": "vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7"
    };
}

function getAjaxHeaders(urlStr, ua) {
    let host = "www.facebook.com";
    try { host = new URL(urlStr).hostname; } catch (_) {}
    const match = (ua || DEFAULT_UA).match(/Chrome\/(\d+)/);
    const major = match ? match[1] : DEFAULT_UA_MAJOR;

    return {
        "Host": host,
        "Connection": "keep-alive",
        "sec-ch-ua": `"Chromium";v="${major}", "Google Chrome";v="${major}", "Not.A/Brand";v="24"`,
        "sec-ch-ua-mobile": "?0",
        "sec-ch-ua-platform": '"Windows"',
        "User-Agent": ua || DEFAULT_UA,
        "Accept": "*/*",
        "Origin": "https://www.facebook.com",
        "Referer": "https://www.facebook.com/",
        "Sec-Fetch-Site": "same-origin",
        "Sec-Fetch-Mode": "cors",
        "Sec-Fetch-Dest": "empty",
        "X-Requested-With": "XMLHttpRequest",
        "Accept-Encoding": "gzip, deflate",
        "Accept-Language": "vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7"
    };
}

function createHttpClient(jar, options = {}) {
    const ua = options.userAgent || DEFAULT_UA;

    function getCookieHeader(url = "https://www.facebook.com") {
        try {
            return jar.getCookiesSync(url).map((c) => `${c.key}=${c.value}`).join("; ");
        } catch (_) { return ""; }
    }

    async function get(url, extraHeaders = {}) {
        let currentUrl = url;
        let hops = 0;
        let res;

        while (hops < 5) {
            hops++;
            const headers = {
                ...getNavHeaders(currentUrl, ua),
                "Cookie": getCookieHeader(currentUrl),
                ...extraHeaders
            };

            res = await axios.get(currentUrl, {
                headers,
                timeout: options.timeout || 20000,
                maxRedirects: 0,
                httpAgent,
                httpsAgent,
                validateStatus: (status) => status >= 200 && status < 400,
                decompress: true
            }).catch((err) => {
                if (err.response) return err.response;
                throw err;
            });

            saveCookies(jar)(res);

            // Xử lý HTTP redirect 3xx
            if (res.status >= 300 && res.status < 400 && res.headers && res.headers.location) {
                let nextUrl = res.headers.location;
                if (nextUrl.startsWith("/")) {
                    nextUrl = "https://www.facebook.com" + nextUrl;
                }
                currentUrl = nextUrl;
                continue;
            }

            // Xử lý meta refresh redirect
            if (res.data && typeof res.data === "string") {
                const metaMatch = res.data.match(/<meta http-equiv="refresh" content="0;url=([^"]+)[^>]+>/i);
                if (metaMatch && metaMatch[1]) {
                    let nextUrl = metaMatch[1].replace(/&amp;/g, "&");
                    if (nextUrl.startsWith("/")) nextUrl = "https://www.facebook.com" + nextUrl;
                    currentUrl = nextUrl;
                    continue;
                }
            }

            break;
        }

        return res;
    }

    async function post(url, formOrJar = {}, extraHeadersOrForm = {}, maybeHeaders = {}) {
        let form = formOrJar;
        let extraHeaders = extraHeadersOrForm;

        // Nếu tham số thứ 2 là CookieJar (FCA truyền thống: post(url, jar, form))
        if (formOrJar && (typeof formOrJar.getCookiesSync === "function" || typeof formOrJar.getCookieStringSync === "function" || formOrJar._jar || formOrJar.store)) {
            form = extraHeadersOrForm;
            extraHeaders = maybeHeaders;
        }

        const params = new URLSearchParams();
        if (form && typeof form === "object") {
            for (const [k, v] of Object.entries(form)) {
                if (v !== undefined && v !== null) params.append(k, String(v));
            }
        }

        const headers = {
            ...getAjaxHeaders(url, ua),
            "Content-Type": "application/x-www-form-urlencoded",
            "Cookie": getCookieHeader(url),
            ...(extraHeaders || {})
        };

        const res = await axios.post(url, params.toString(), {
            headers,
            timeout: options.timeout || 20000,
            httpAgent,
            httpsAgent,
            validateStatus: () => true,
            decompress: true
        });
        saveCookies(jar)(res);
        return res;
    }

    async function postJSON(url, body = {}, extraHeaders = {}) {
        const headers = {
            ...getAjaxHeaders(url, ua),
            "Content-Type": "application/json",
            "Cookie": getCookieHeader(url),
            ...extraHeaders
        };

        const res = await axios.post(url, body, {
            headers,
            timeout: options.timeout || 20000,
            httpAgent,
            httpsAgent,
            validateStatus: () => true,
            decompress: true
        });
        saveCookies(jar)(res);
        return res;
    }

    async function graphql(form = {}, ctx = {}) {
        const payload = {
            ...form,
            fb_dtsg:  ctx.fb_dtsg  || form.fb_dtsg,
            jazoest:  ctx.jazoest  || form.jazoest,
            lsd:      ctx.lsd      || form.lsd
        };
        return post("https://www.facebook.com/api/graphql/", payload, {
            "X-FB-Friendly-Name": form.fb_api_req_friendly_name || ""
        });
    }

    return { get, post, postJSON, graphql, getCookieHeader };
}

module.exports = { createHttpClient, DEFAULT_UA };
