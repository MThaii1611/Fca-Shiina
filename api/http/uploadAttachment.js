api: "api.uploadAttachment";

/**
 * api/http/uploadAttachment.js
 * Framework Shiina - uploadAttachment
 * Upload ảnh, video, âm thanh và tệp lên Meta qua giao thức rupload.facebook.com
 * Hỗ trợ: Stream (fs.createReadStream), Buffer, Local File Path, URL trực tiếp
 */

const fs = require("fs-extra");
const path = require("path");
const axios = require("axios");
const { randomUUID } = require("crypto");
const { Readable } = require("stream");
const logger = require("../../shiina/logger");

const MIME_MAP = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".mp4": "video/mp4",
    ".mov": "video/quicktime",
    ".mp3": "audio/mpeg",
    ".wav": "audio/wav",
    ".ogg": "audio/ogg",
    ".pdf": "application/pdf",
    ".aac": "audio/aac",
    ".m4a": "audio/mp4"
};

const UPLOAD_TYPE_MAP = {
    image: { endpointType: "image", headerField: "image_type" },
    video: { endpointType: "video", headerField: "video_type" },
    audio: { endpointType: "audio", headerField: "audio_type" }
};

function detectMimeFromBuffer(buf) {
    if (!buf || buf.length < 4) return null;
    if (buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) return { mime: "image/jpeg", ext: ".jpg" };
    if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47) return { mime: "image/png", ext: ".png" };
    if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38) return { mime: "image/gif", ext: ".gif" };
    if (buf.length >= 12 && buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") return { mime: "image/webp", ext: ".webp" };
    if (buf.length >= 8 && (buf.toString("ascii", 4, 8) === "ftyp" || buf.toString("ascii", 4, 8) === "moov")) return { mime: "video/mp4", ext: ".mp4" };
    if ((buf.length >= 3 && buf.toString("ascii", 0, 3) === "ID3") || (buf[0] === 0xFF && (buf[1] & 0xE0) === 0xE0)) return { mime: "audio/mpeg", ext: ".mp3" };
    if (buf.length >= 4 && buf.toString("ascii", 0, 4) === "OggS") return { mime: "audio/ogg", ext: ".ogg" };
    if (buf.length >= 12 && buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WAVE") return { mime: "audio/wav", ext: ".wav" };
    if (buf.length >= 4 && buf.toString("ascii", 0, 4) === "%PDF") return { mime: "application/pdf", ext: ".pdf" };
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
    if (mimeType.startsWith("image/")) return { endpointType: "image", headerField: "image_type" };
    if (mimeType.startsWith("video/")) return { endpointType: "video", headerField: "video_type" };
    if (mimeType.startsWith("audio/")) return { endpointType: "audio", headerField: "audio_type" };
    if (mimeType === "application/pdf") return { endpointType: "file", headerField: "file_type" };
    return { endpointType: "file", headerField: "file_type" };
}

async function streamToBuffer(stream) {
    const chunks = [];
    return new Promise((resolve, reject) => {
        stream.on("data", (chunk) => chunks.push(chunk));
        stream.on("end", () => resolve(Buffer.concat(chunks)));
        stream.on("error", reject);
    });
}

function isReadableStream(obj) {
    return (
        obj instanceof Readable ||
        (obj !== null &&
            typeof obj === "object" &&
            typeof obj.pipe === "function" &&
            typeof obj.on === "function" &&
            obj.readable !== false)
    );
}

const uniqueSeg = () => Math.random().toString(36).slice(2, 8);

async function uploadViaRupload(buffer, fileName, cookie, userId, ctx) {
    const ua = ctx.options?.userAgent || "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36";
    const mimeType = guessMimeType(fileName, buffer);
    const { endpointType, headerField } = determineUploadType(mimeType);
    const attachId = randomUUID();
    const contentLength = buffer.length;

    const params = new URLSearchParams({
        __aaid: "0",
        __user: userId,
        __a: "1",
        __req: Math.floor(Math.random() * 100).toString(36),
        dpr: "1",
        __ccg: "EXCELLENT",
        __rev: "1049946321",
        __s: `${uniqueSeg()}:${uniqueSeg()}`,
        __hsi: Date.now().toString(),
        __comet_req: "15",
        __spin_r: "1049946321",
        __spin_b: "trunk",
        __spin_t: Date.now().toString()
    });
    if (ctx.fb_dtsg) params.set("fb_dtsg", ctx.fb_dtsg);
    if (ctx.jazoest) params.set("jazoest", ctx.jazoest);
    if (ctx.lsd) params.set("lsd", ctx.lsd);

    const res = await axios.post(
        `https://rupload.facebook.com/messenger_${endpointType}/${attachId}?${params.toString()}`,
        buffer,
        {
            timeout: 120000,
            maxRedirects: 5,
            maxContentLength: Infinity,
            maxBodyLength: Infinity,
            headers: {
                "accept": "*/*",
                "accept-encoding": "gzip, deflate, br",
                "content-length": String(contentLength),
                "content-type": "application/octet-stream",
                "offset": "0",
                "origin": "https://www.facebook.com",
                "referer": "https://www.facebook.com/",
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
    if (!body) throw new Error("Rupload không trả về phản hồi hợp lệ");

    const mediaId = body.image_id || body.media_id || body.file_id || body.audio_id || body.video_id || body.id;
    if (!mediaId) throw new Error("Không nhận được ID upload hợp lệ từ Meta: " + JSON.stringify(body));

    if (endpointType === "image") return { image_id: String(mediaId), fbid: String(mediaId) };
    if (endpointType === "video") return { video_id: String(mediaId), media_id: String(mediaId), fbid: String(mediaId) };
    if (endpointType === "audio") return { audio_id: String(mediaId), fbid: String(mediaId) };
    return { file_id: String(mediaId), fbid: String(mediaId) };
}

async function uploadWithRetry(buffer, fileName, cookie, userId, ctx) {
    let lastErr = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
        try {
            return await uploadViaRupload(buffer, fileName, cookie, userId, ctx);
        } catch (err) {
            lastErr = err;
            if (attempt < 3) {
                await new Promise((r) => setTimeout(r, 1000 * attempt));
            }
        }
    }
    throw lastErr;
}

module.exports = function(ctx, http, api) {
    return async function uploadAttachment(attachments, callback) {
        let resolveFunc = () => {};
        let rejectFunc = () => {};
        const returnPromise = new Promise((resolve, reject) => {
            resolveFunc = resolve;
            rejectFunc = reject;
        });

        if (typeof callback !== "function") {
            callback = (err, data) => (err ? rejectFunc(err) : resolveFunc(data));
        }

        try {
            if (!attachments) {
                callback(null, []);
                return returnPromise;
            }

            const list = Array.isArray(attachments) ? attachments : [attachments];
            const cookie = ctx.jar
                ? ctx.jar.getCookiesSync("https://www.facebook.com").map((c) => `${c.key}=${c.value}`).join("; ")
                : "";
            const userId = String(ctx.userID || "");

            const uploadTasks = list.map(async (item) => {
                if (item && typeof item === "object" && (item.image_id || item.video_id || item.media_id || item.audio_id || item.fbid)) {
                    return item;
                }

                let buffer;
                let fileName = "file.bin";

                if (isReadableStream(item) || isReadableStream(item?.stream)) {
                    const s = isReadableStream(item) ? item : item.stream;
                    buffer = await streamToBuffer(s);
                    if (s.path && typeof s.path === "string") fileName = path.basename(s.path);
                    else if (item.filename) fileName = item.filename;
                } else if (Buffer.isBuffer(item)) {
                    buffer = item;
                } else if (Buffer.isBuffer(item?.buffer)) {
                    buffer = item.buffer;
                    if (item.filename) fileName = item.filename;
                } else if (typeof item === "string") {
                    if (item.startsWith("http://") || item.startsWith("https://")) {
                        const res = await axios.get(item, { responseType: "arraybuffer", timeout: 60000 });
                        buffer = Buffer.from(res.data);
                        try {
                            const p = new URL(item).pathname;
                            if (path.extname(p)) fileName = path.basename(p);
                        } catch (_) {}
                    } else if (fs.existsSync(item)) {
                        buffer = await fs.readFile(item);
                        fileName = path.basename(item);
                    } else {
                        buffer = Buffer.from(item);
                    }
                } else if (item && typeof item.path === "string" && fs.existsSync(item.path)) {
                    buffer = await fs.readFile(item.path);
                    fileName = path.basename(item.path);
                } else {
                    throw new Error("uploadAttachment: Định dạng attachment không hỗ trợ");
                }

                const detected = detectMimeFromBuffer(buffer);
                if (detected) {
                    const curExt = path.extname(fileName || "").toLowerCase();
                    if (!curExt || !MIME_MAP[curExt]) {
                        const baseName = (!fileName || fileName === "file" || fileName === "file.bin") ? ("media_" + Date.now()) : path.basename(fileName, curExt);
                        fileName = baseName + detected.ext;
                    }
                }

                return await uploadWithRetry(buffer, fileName, cookie, userId, ctx);
            });

            const results = await Promise.all(uploadTasks);
            callback(null, results);
            resolveFunc(results);
        } catch (err) {
            callback(err);
            rejectFunc(err);
        }

        return returnPromise;
    };
};