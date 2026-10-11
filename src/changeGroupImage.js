"use strict";

var utils = require("../utils");
var log = require("npmlog");
var axios = require("axios");
const { randomUUID } = require("crypto");
const fs = require("fs");
const path = require("path");

const between = (html, start, end) => {
  const si = html.indexOf(start);
  if (si < 0) return "";
  const from = si + start.length;
  const to = html.indexOf(end, from);
  return to < 0 ? "" : html.slice(from, to);
};
const pick = (re, html) => (html.match(re) || [])[1] || "";
const parseTokensFromHtml = (html) => ({
  fb_dtsg: between(html, '"DTSGInitData",[],{"token":"', '",') || pick(/name="fb_dtsg"\s+value="([^"]+)"/, html),
  jazoest: between(html, 'name="jazoest" value="', '"') || pick(/name="jazoest"\s+value="([^"]+)"/, html),
  lsd: between(html, '["LSD",[],{"token":"', '"}') || pick(/name="lsd"\s+value="([^"]+)"/, html),
  spin_r: pick(/"__spin_r":(\d+)/, html),
  spin_t: pick(/"__spin_t":(\d+)/, html),
  rev: pick(/"__rev":(\d+)/, html),
});

let cachedTokens = null;
let tokenFetchedAt = 0;

async function getTokens(ctx, cookie) {
  if (ctx && ctx.fb_dtsg) {
    return {
      fb_dtsg: ctx.fb_dtsg,
      jazoest: ctx.jazoest || ctx.ttstamp || "22",
      lsd: ctx.lsd || ctx.fb_dtsg || "",
      rev: "1041009797",
      spin_r: "1041009797",
      spin_t: Date.now().toString()
    };
  }

  const now = Date.now();
  if (cachedTokens && now - tokenFetchedAt < 10 * 60 * 1000) return cachedTokens;

  const dtsg = (ctx && ctx.fb_dtsg) || (global.Fca && global.Fca.Data && global.Fca.Data.fb_dtsg) || "";
  let jazoest = (ctx && (ctx.jazoest || ctx.ttstamp)) || "";
  if (!jazoest && dtsg) {
    let sum = 0;
    for (let i = 0; i < dtsg.length; i++) sum += dtsg.charCodeAt(i);
    jazoest = `2${sum}`;
  }

  let tokens = {
    fb_dtsg: dtsg,
    jazoest: jazoest || "22",
    lsd: (ctx && (ctx.lsd || ctx.fb_dtsg)) || dtsg || "",
    rev: "1049956878",
    spin_r: "1049956878",
    spin_t: Date.now().toString()
  };

  if (tokens.fb_dtsg) {
    cachedTokens = tokens;
    tokenFetchedAt = now;
    return tokens;
  }

  const ua = (ctx && ctx.globalOptions && ctx.globalOptions.userAgent) || "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
  try {
    const res = await axios.get("https://www.facebook.com/", {
      headers: { "User-Agent": ua, "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8", "Accept-Language": "vi-VN,vi;q=0.9,en-US;q=0.6,en;q=0.5", "Accept-Encoding": "gzip, deflate, br", "Cookie": cookie, "Sec-Fetch-Dest": "document", "Sec-Fetch-Mode": "navigate", "Sec-Fetch-Site": "none", "Upgrade-Insecure-Requests": "1" },
      timeout: 15000, maxRedirects: 5,
    });
    const html = typeof res.data === "string" ? res.data : String(res.data || "");
    const parsed = parseTokensFromHtml(html);
    if (parsed.fb_dtsg) {
      tokens = {
        fb_dtsg: parsed.fb_dtsg,
        jazoest: parsed.jazoest || tokens.jazoest,
        lsd: parsed.lsd || tokens.lsd,
        rev: parsed.rev || tokens.rev,
        spin_r: parsed.spin_r || tokens.spin_r,
        spin_t: parsed.spin_t || tokens.spin_t
      };
    }
  } catch (e) {}

  cachedTokens = tokens;
  tokenFetchedAt = now;
  return tokens;
}

const uniqueSeg = () => Math.random().toString(36).slice(2, 8);

async function uploadImageViaRupload(imageBuffer, cookie, userId, ctx) {
  const ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
  const fileName = "group_avatar.jpg";
  const mimeType = "image/jpeg";
  const attachId = randomUUID();
  const contentLength = imageBuffer.length;

  const tokens = await getTokens(ctx, cookie);
  const params = new URLSearchParams({
    __aaid: "0", __user: userId, __a: "1",
    __req: Math.floor(Math.random() * 100).toString(36),
    dpr: "1", __ccg: "EXCELLENT",
    __rev: tokens.rev || "1041009797",
    __s: `${uniqueSeg()}:${uniqueSeg()}:${uniqueSeg()}`,
    __hsi: Date.now().toString(), __comet_req: "15",
    __spin_r: tokens.spin_r || "1041009797", __spin_b: "trunk",
    __spin_t: tokens.spin_t || Date.now().toString(),
  });
  if (tokens.fb_dtsg) params.set("fb_dtsg", tokens.fb_dtsg);
  if (tokens.jazoest) params.set("jazoest", tokens.jazoest);
  if (tokens.lsd) params.set("lsd", tokens.lsd);

  const res = await axios.post(
    `https://rupload.facebook.com/messenger_image/${attachId}?${params.toString()}`,
    imageBuffer,
    {
      timeout: 120000, maxRedirects: 5, maxContentLength: Infinity, maxBodyLength: Infinity,
      headers: {
        "accept": "*/*", "accept-encoding": "gzip, deflate, br, zstd",
        "accept-language": "vi-VN,vi;q=0.9,en-US;q=0.6,en;q=0.5",
        "content-length": String(contentLength), "content-type": "application/octet-stream",
        "offset": "0", "origin": "https://www.facebook.com", "priority": "u=1, i",
        "referer": "https://www.facebook.com/",
        "sec-ch-ua": '"Chromium";v="126", "Google Chrome";v="126", "Not.A/Brand";v="24"',
        "sec-ch-ua-mobile": "?0", "sec-ch-ua-platform": '"Windows"',
        "sec-fetch-dest": "empty", "sec-fetch-mode": "cors", "sec-fetch-site": "same-site",
        "target_id": userId, "user-agent": ua,
        "x-entity-length": String(contentLength), "x-entity-name": fileName,
        "x-entity-type": mimeType, "image_type": "FILE_ATTACHMENT", "cookie": cookie
      }
    }
  );

  const body = res.data;
  if (!body) throw new Error(`Rupload không trả về response`);
  const id = body.image_id || body.media_id || body.photo_id;
  if (!id) throw new Error(`Không nhận được image_id: ${JSON.stringify(body)}`);
  return String(id);
}

async function uploadWithRetry(imageBuffer, cookie, userId, ctx) {
  try {
    return await uploadImageViaRupload(imageBuffer, cookie, userId, ctx);
  } catch (err1) {
    log.warn("changeGroupImage", `Lần 1 thất bại: ${err1.message} - thử lại...`);
    cachedTokens = null;
    await new Promise(r => setTimeout(r, 1000));
    try {
      return await uploadImageViaRupload(imageBuffer, cookie, userId, ctx);
    } catch (err2) {
      log.warn("changeGroupImage", `Lần 2 thất bại: ${err2.message} - thử lại lần cuối...`);
      cachedTokens = null;
      await new Promise(r => setTimeout(r, 2000));
      return await uploadImageViaRupload(imageBuffer, cookie, userId, ctx);
    }
  }
}

async function toBuffer(image) {
  if (Buffer.isBuffer(image)) return image;

  if (image && typeof image === "object") {
    if (image.value) {
      return Buffer.isBuffer(image.value) ? image.value : Buffer.from(image.value);
    }
    if (typeof image.pipe === "function") {
      return new Promise((resolve, reject) => {
        const chunks = [];
        image.on("data", chunk => chunks.push(chunk));
        image.on("end", () => resolve(Buffer.concat(chunks)));
        image.on("error", reject);
      });
    }
  }

  if (typeof image === "string") {
    if (/^https?:\/\//i.test(image)) {
      const res = await axios.get(image, { responseType: "arraybuffer", timeout: 60000 });
      return Buffer.from(res.data);
    }
    if (/^data:([^;,]+)?(;base64)?,(.*)$/i.test(image)) {
      const parts = image.split(",");
      return Buffer.from(parts[1] || "", "base64");
    }
    if (fs.existsSync(image)) {
      return fs.readFileSync(image);
    }
  }

  throw new Error("Định dạng ảnh không hỗ trợ: " + typeof image);
}

module.exports = function(defaultFuncs, api, ctx) {
  return function changeGroupImage(image, threadID, callback) {
    if (!callback && (utils.getType(threadID) === "Function" || utils.getType(threadID) === "AsyncFunction")) {
      throw { error: "please pass a threadID as a second argument." };
    }

    var resolveFunc = function(){};
    var rejectFunc = function(){};
    var returnPromise = new Promise(function (resolve, reject) {
      resolveFunc = resolve;
      rejectFunc = reject;
    });

    if (!callback) {
      callback = function(err, data) {
        if (err) return rejectFunc(err);
        resolveFunc(data);
      };
    }

    if (!threadID) {
      var errNoThread = { error: "threadID is required" };
      callback(errNoThread);
      return rejectFunc(errNoThread);
    }

    const cleanThreadID = String(threadID).trim();
    const appState = ctx.jar.getCookies("https://www.facebook.com");
    const cookie = appState.map(c => `${c.key}=${c.value}`).join("; ");
    const cUser = appState.find(c => c.key === "c_user");
    const userId = cUser ? cUser.value : ctx.userID || "";

    var isConnected = !!(
      (ctx.mqttClient && ctx.mqttClient.connected) ||
      (ctx.gatewayClient && ctx.gatewayClient.connected)
    );

    var settled = false;
    function settleSuccess(mediaId) {
      if (!settled) {
        settled = true;
        var res = { success: true, image_id: mediaId };
        callback(null, res);
        resolveFunc(res);
      }
    }

    function settleError(err) {
      if (!settled) {
        settled = true;
        log.error("changeGroupImage", err);
        callback(err);
        rejectFunc(err);
      }
    }

    function applyMediaId(mediaId) {
      const threadKey = Number.isSafeInteger(Number(cleanThreadID)) ? Number(cleanThreadID) : cleanThreadID;
      const imageId = Number.isSafeInteger(Number(mediaId)) ? Number(mediaId) : String(mediaId);

      const task = {
        label: utils.LIGHTSPEED_LABELS?.SET_THREAD_IMAGE || "37",
        payload: {
          thread_key: threadKey,
          image_id: imageId,
          sync_group: 1
        },
        queue_name: "thread_image",
        task_id: 1,
        failure_count: null
      };

      if (isConnected) {
        utils.sendLsTask(ctx, task, { noWaitAck: true }).catch(function() {});
        settleSuccess(mediaId);
      } else {
        settleError(new Error("Not connected to MQTT/Gateway"));
      }
    }

    // Check if image is already an image_id object or number
    if (image && typeof image === "object" && (image.image_id || image.media_id)) {
      applyMediaId(String(image.image_id || image.media_id));
      return returnPromise;
    }
    if (typeof image === "string" && /^\d{10,25}$/.test(image.trim())) {
      applyMediaId(image.trim());
      return returnPromise;
    }

    toBuffer(image)
      .then(buf => uploadWithRetry(buf, cookie, userId, ctx))
      .then(function(mediaId) {
        applyMediaId(mediaId);
      })
      .catch(function(err) {
        settleError(err);
      });

    return returnPromise;
  };
};