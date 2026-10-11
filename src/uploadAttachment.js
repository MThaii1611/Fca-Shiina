"use strict";

var utils = require("../utils");
var log = require("npmlog");
var bluebird = require("bluebird");
var fs = require("fs-extra");
var axios = require("axios");
const { Readable } = require("stream");
const { randomUUID } = require("crypto");
const path = require("path");

const MIME_MAP = {
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png",
  ".gif": "image/gif", ".webp": "image/webp", ".mp4": "video/mp4",
  ".mov": "video/quicktime", ".mp3": "audio/mpeg", ".wav": "audio/wav",
  ".pdf": "application/pdf",
};

const UPLOAD_TYPE_MAP = {
  image: { endpointType: "image", headerField: "image_type" },
  video: { endpointType: "video", headerField: "video_type" },
  audio: { endpointType: "audio", headerField: "audio_type" },
};

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

async function fetchTokens(cookie, ctx) {
  if (ctx && ctx.fb_dtsg) {
    return {
      fb_dtsg: ctx.fb_dtsg,
      jazoest: ctx.jazoest || ctx.ttstamp || "22",
      lsd: ctx.lsd || ctx.fb_dtsg || "",
      rev: "1049946321",
      spin_r: "1049946321",
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

  // Nếu đã có fb_dtsg thì tuyệt đối không cào web để tránh bị checkpoint!
  if (tokens.fb_dtsg) {
    cachedTokens = tokens;
    tokenFetchedAt = now;
    return tokens;
  }

  // Trường hợp hiếm không có sẵn fb_dtsg: chỉ request trang chủ https://www.facebook.com/ (KHÔNG request /messages/)
  const ua = (ctx && ctx.globalOptions && ctx.globalOptions.userAgent) || "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
  try {
    const res = await axios.get("https://www.facebook.com/", {
      headers: {
        "User-Agent": ua,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "vi-VN,vi;q=0.9,en-US;q=0.6,en;q=0.5",
        "Accept-Encoding": "gzip, deflate, br",
        "Cookie": cookie,
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "none",
        "Upgrade-Insecure-Requests": "1",
      },
      timeout: 15000,
      maxRedirects: 5,
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
  } catch (e) {
    log.warn("uploadAttachment", `Lỗi fetch token dự phòng: ${e.message}`);
  }

  cachedTokens = tokens;
  tokenFetchedAt = now;
  return tokens;
}

function detectMimeFromBuffer(buf) {
  if (!buf || buf.length < 4) return null;
  // JPEG: FF D8 FF
  if (buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) {
    return { mime: "image/jpeg", ext: ".jpg" };
  }
  // PNG: 89 50 4E 47
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47) {
    return { mime: "image/png", ext: ".png" };
  }
  // GIF: GIF87a / GIF89a (47 49 46 38)
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38) {
    return { mime: "image/gif", ext: ".gif" };
  }
  // WEBP: RIFF....WEBP
  if (buf.length >= 12 && buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") {
    return { mime: "image/webp", ext: ".webp" };
  }
  // MP4 / MOV: ....ftyp or ....moov
  if (buf.length >= 8 && (buf.toString("ascii", 4, 8) === "ftyp" || buf.toString("ascii", 4, 8) === "moov")) {
    return { mime: "video/mp4", ext: ".mp4" };
  }
  // MP3: ID3 or MPEG sync
  if (buf.length >= 3 && buf.toString("ascii", 0, 3) === "ID3") {
    return { mime: "audio/mpeg", ext: ".mp3" };
  }
  if (buf[0] === 0xFF && (buf[1] & 0xE0) === 0xE0) {
    return { mime: "audio/mpeg", ext: ".mp3" };
  }
  // OGG: OggS
  if (buf.length >= 4 && buf.toString("ascii", 0, 4) === "OggS") {
    return { mime: "audio/ogg", ext: ".ogg" };
  }
  // WAV: RIFF....WAVE
  if (buf.length >= 12 && buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WAVE") {
    return { mime: "audio/wav", ext: ".wav" };
  }
  // PDF: %PDF
  if (buf.length >= 4 && buf.toString("ascii", 0, 4) === "%PDF") {
    return { mime: "application/pdf", ext: ".pdf" };
  }
  return null;
}

function guessMimeType(filename, buffer) {
  if (buffer) {
    const detected = detectMimeFromBuffer(buffer);
    if (detected) return detected.mime;
  }
  const ext = path.extname(String(filename || "")).toLowerCase();
  if (ext && MIME_MAP[ext]) return MIME_MAP[ext];
  const base = path.basename(String(filename || "")).toLowerCase();
  for (const [k, v] of Object.entries(MIME_MAP)) {
    if (base.endsWith(k)) return v;
  }
  return "application/octet-stream";
}

function determineUploadType(mimeType) {
  if (typeof mimeType !== "string") return { endpointType: "file", headerField: "file_type" };
  if (mimeType.startsWith("image/")) {
    return { endpointType: "image", headerField: "image_type" };
  }
  if (mimeType.startsWith("video/")) {
    return { endpointType: "video", headerField: "video_type" };
  }
  if (mimeType.startsWith("audio/")) {
    return { endpointType: "audio", headerField: "audio_type" };
  }
  if (mimeType === "application/pdf") {
    return { endpointType: "file", headerField: "file_type" };
  }
  return { endpointType: "file", headerField: "file_type" };
}

const uniqueSeg = () => Math.random().toString(36).slice(2, 8);

async function uploadViaRupload(buffer, fileName, cookie, userId, ctx) {
  const ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
  const mimeType = guessMimeType(fileName, buffer);
  const { endpointType, headerField } = determineUploadType(mimeType);
  const attachId = randomUUID();
  const contentLength = buffer.length;

  const tokens = await fetchTokens(cookie, ctx);

  const params = new URLSearchParams({
    __aaid: "0", __user: userId, __a: "1",
    __req: Math.floor(Math.random() * 100).toString(36),
    dpr: "1", __ccg: "EXCELLENT",
    __rev: tokens.rev || "1041009797",
    __s: `${uniqueSeg()}:${uniqueSeg()}:${uniqueSeg()}`,
    __hsi: Date.now().toString(), __comet_req: "15",
    __spin_r: tokens.spin_r || "1041009797",
    __spin_b: "trunk",
    __spin_t: tokens.spin_t || Date.now().toString(),
  });
  if (tokens.fb_dtsg) params.set("fb_dtsg", tokens.fb_dtsg);
  if (tokens.jazoest) params.set("jazoest", tokens.jazoest);
  if (tokens.lsd) params.set("lsd", tokens.lsd);

  const res = await axios.post(
    `https://rupload.facebook.com/messenger_${endpointType}/${attachId}?${params.toString()}`,
    buffer,
    {
      timeout: 120000, maxRedirects: 5,
      maxContentLength: Infinity, maxBodyLength: Infinity,
      headers: {
        "accept": "*/*",
        "accept-encoding": "gzip, deflate, br, zstd",
        "accept-language": "vi-VN,vi;q=0.9,en-US;q=0.6,en;q=0.5",
        "content-length": String(contentLength),
        "content-type": "application/octet-stream",
        "offset": "0",
        "origin": "https://www.facebook.com",
        "priority": "u=1, i",
        "referer": "https://www.facebook.com/",
        "sec-ch-ua": '"Chromium";v="126", "Google Chrome";v="126", "Not.A/Brand";v="24"',
        "sec-ch-ua-mobile": "?0",
        "sec-ch-ua-platform": '"Windows"',
        "sec-fetch-dest": "empty",
        "sec-fetch-mode": "cors",
        "sec-fetch-site": "same-site",
        "target_id": userId,
        "user-agent": ua,
        "x-entity-length": String(contentLength),
        "x-entity-name": fileName,
        "x-entity-type": mimeType,
        [headerField]: "FILE_ATTACHMENT",
        "cookie": cookie
      }
    }
  );

  let body = res.data;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body.replace(/^[^{]*/, ""));
    } catch (_) {}
  }
  if (body && typeof body === "object" && body.payload) body = body.payload;
  if (!body) throw new Error(`Rupload không trả về response`);

  const mediaId = body.image_id || body.media_id || body.file_id || body.audio_id || body.video_id || body.id;
  if (!mediaId) throw new Error(`Không nhận được ID hợp lệ: ${JSON.stringify(body)}`);

  if (endpointType === "image") return { image_id: String(mediaId) };
  if (endpointType === "video") return { media_id: String(mediaId), video_id: String(mediaId) };
  if (endpointType === "audio") return { audio_id: String(mediaId) };
  return { file_id: String(mediaId) };
}

async function uploadWithRetry(buffer, fileName, cookie, userId, ctx) {
  const tryOnce = async () => {
    return await uploadViaRupload(buffer, fileName, cookie, userId, ctx);
  };

  try {
    return await tryOnce();
  } catch (err1) {
    log.warn("uploadAttachment", `Lần 1 thất bại: ${err1.message} - thử lại...`);
    cachedTokens = null;
    await new Promise(r => setTimeout(r, 1000));
    try {
      return await tryOnce();
    } catch (err2) {
      log.warn("uploadAttachment", `Lần 2 thất bại: ${err2.message} - thử lần cuối...`);
      cachedTokens = null;
      await new Promise(r => setTimeout(r, 2000));
      try {
        return await tryOnce();
      } catch (err3) {
        log.error("uploadAttachment", `Lần 3 thất bại: ${err3.message} - bỏ qua`);
        throw err3;
      }
    }
  }
}

async function streamToBuffer(stream) {
  const chunks = [];
  return new Promise((resolve, reject) => {
    stream.on("data", chunk => chunks.push(chunk));
    stream.on("end", () => resolve(Buffer.concat(chunks)));
    stream.on("error", reject);
  });
}

function dataUrlToBuffer(dataUrl) {
  const m = /^data:([^;,]+)?(;base64)?,(.*)$/i.exec(dataUrl || "");
  if (!m) return null;
  const isBase64 = !!m[2];
  const payload = m[3] || "";
  return Buffer.from(payload, isBase64 ? "base64" : "utf8");
}

function isIdTuple(item) {
  return Array.isArray(item) && item.length === 2 && typeof item[0] === "string" && /_id$/.test(item[0]);
}

function normalizeItem(item) {
  if (isIdTuple(item)) {
    return { passthrough: { [item[0]]: String(item[1]) } };
  }
  if (Array.isArray(item) && item.length === 1 && isIdTuple(item[0])) {
    return { passthrough: { [item[0][0]]: String(item[0][1]) } };
  }
  if (utils.isReadableStream(item)) {
    const streamPath = typeof item.path === "string" ? item.path : null;
    return { stream: item, fileName: streamPath ? path.basename(streamPath) : (item.filename || "file") };
  }
  if (Buffer.isBuffer(item)) {
    return { buffer: item, fileName: item.filename || "file" };
  }
  if (typeof item === "string") {
    if (/^https?:\/\//i.test(item)) {
      try {
        const parsedUrl = new URL(item);
        const fname = path.basename(parsedUrl.pathname) || "image.jpg";
        return { remoteUrl: item, fileName: fname };
      } catch (_) {}
    }
    if (/^data:/i.test(item)) {
      const m = item.match(/^data:([^;,]+)/i);
      const ext = m ? (m[1].split("/")[1] || "bin") : "bin";
      const buf = dataUrlToBuffer(item);
      if (!buf) throw { error: "Invalid data URL" };
      return { buffer: buf, fileName: `file.${ext}` };
    }
    if (fs.existsSync(item)) {
      return { filePath: item, fileName: path.basename(item) };
    }
  }
  if (item && typeof item === "object" && !Buffer.isBuffer(item)) {
    if (item.passthrough) return item;
    for (const k of ["media_id", "photo_id", "video_id", "audio_id", "file_id", "fbid", "attachment_id"]) {
      if (item[k]) {
        return { passthrough: { [k]: String(item[k]) } };
      }
    }
    if (utils.isReadableStream(item.stream || item)) {
      const s = item.stream || item;
      const streamPath = typeof s.path === "string" ? s.path : null;
      const fname = streamPath ? path.basename(streamPath) : (item.filename || s.filename || "file");
      return { stream: s, fileName: fname };
    }
    if (Buffer.isBuffer(item.buffer)) {
      return { buffer: item.buffer, fileName: item.filename || "file" };
    }
    if (typeof item.path === "string" && fs.existsSync(item.path)) {
      return { filePath: item.path, fileName: path.basename(item.path) };
    }
    if (typeof item.url === "string" && /^https?:\/\//i.test(item.url)) {
      const fname = path.basename(new URL(item.url).pathname) || "file";
      return { remoteUrl: item.url, fileName: fname };
    }
  }
  throw { error: "Attachment không hợp lệ: " + utils.getType(item) };
}

async function processItem(normalized, cookie, userId, ctx) {
  if (normalized.passthrough) return normalized.passthrough;

  let buffer, fileName;

  if (normalized.filePath) {
    buffer = fs.readFileSync(normalized.filePath);
    fileName = normalized.fileName;
  } else if (normalized.buffer) {
    buffer = normalized.buffer;
    fileName = normalized.fileName || "file";
  } else if (normalized.stream) {
    buffer = await streamToBuffer(normalized.stream);
    fileName = normalized.fileName || "file";
  } else if (normalized.remoteUrl) {
    const res = await axios({ url: normalized.remoteUrl, method: "GET", responseType: "arraybuffer", timeout: 60000, maxRedirects: 10, headers: { "User-Agent": "Mozilla/5.0", "Accept": "*/*" } });
    buffer = Buffer.from(res.data);
    fileName = normalized.fileName || "file";
  } else {
    throw { error: "Không thể xử lý attachment" };
  }

  // Tự động nhận diện định dạng từ Buffer (Magic bytes)
  const detected = detectMimeFromBuffer(buffer);
  if (detected) {
    const curExt = path.extname(fileName || "").toLowerCase();
    if (!curExt || curExt === ".bin" || curExt === ".txt" || !MIME_MAP[curExt]) {
      const baseName = (!fileName || fileName === "file") ? ("image_" + Date.now()) : path.basename(fileName, curExt);
      fileName = (baseName === "file" ? "image_" + Date.now() : baseName) + detected.ext;
    }
  } else if (!fileName || fileName === "file" || !path.extname(fileName)) {
    fileName = (fileName && fileName !== "file") ? fileName : `file_${Date.now()}`;
  }

  const result = await uploadWithRetry(buffer, fileName, cookie, userId, ctx);
  return result;
}

module.exports = function (defaultFuncs, api, ctx) {
  return function uploadAttachment(attachments, callback) {
    var resolveFunc = function () {};
    var rejectFunc = function () {};
    var returnPromise = new Promise(function (resolve, reject) {
      resolveFunc = resolve;
      rejectFunc = reject;
    });

    if (utils.getType(callback) !== "Function") {
      callback = function (err, data) {
        if (err) return rejectFunc(err);
        resolveFunc(data);
      };
    }

    try {
      if (!attachments) {
        callback(null, []);
        return returnPromise;
      }
      if (isIdTuple(attachments)) {
        attachments = [attachments];
      } else if (utils.getType(attachments) !== "Array") {
        attachments = [attachments];
      }

      const appState = ctx.jar.getCookies("https://www.facebook.com");
      const cookie = appState.map(c => `${c.key}=${c.value}`).join("; ");
      const cUser = appState.find(c => c.key === "c_user");
      const userId = cUser ? cUser.value : ctx.userID || "";

      const uploads = attachments.map(async (item) => {
        const normalized = normalizeItem(item);
        return await processItem(normalized, cookie, userId, ctx);
      });

      bluebird.all(uploads)
        .then(function (res) { callback(null, res); })
        .catch(function (err) {
          log.error("uploadAttachment", err);
          callback(err);
        });
    } catch (err) {
      log.error("uploadAttachment", err);
      callback(err);
    }

    return returnPromise;
  };
};