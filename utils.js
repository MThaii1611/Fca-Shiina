

"use strict";
var url = require("url");
var log = require("npmlog");
var stream = require("stream");
var bluebird = require("bluebird");
var querystring = require("querystring");
var request = bluebird.promisify(require("request").defaults({ jar: true, gzip: true }));
const util = require('util');
if (util.isArray && typeof Array.isArray === 'function') {
    util.isArray = Array.isArray;
}

function setProxy(url) {
    if (typeof url == "undefined") return request = bluebird.promisify(require("request").defaults({ jar: true, gzip: true }));
    return request = bluebird.promisify(require("request").defaults({ jar: true, gzip: true, proxy: url }));
}

const DEFAULT_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36";
const DEFAULT_UA_MAJOR = "133";

function sanitizeHeaderValue(value) {
    if (value === null || value === undefined) return "";
    var str = String(value);
    if (str.trim().startsWith("[") && str.trim().endsWith("]")) {
        try {
            var parsed = JSON.parse(str);
            if (Array.isArray(parsed)) return "";
        } catch (_) { }
    }
    str = str.replace(/[\x00-\x08\x0B-\x0C\x0E-\x1F\x7F\r\n\[\]]/g, "").trim();
    return str;
}

function sanitizeHeaderName(name) {
    if (!name || typeof name !== "string") return "";
    return name.replace(/[^\x21-\x7E]/g, "").trim();
}

function isNavigationRequest(method, pathname) {
    var m = String(method || "GET").toUpperCase();
    if (m !== "GET") return false;
    var p = pathname || "/";
    if (p === "/" || p === "") return true;
    if (/\.php$/i.test(p)) return true;
    if (p.indexOf("/checkpoint") === 0) return true;
    return false;
}

function getHeaders(url, options, ctx, customHeader, method) {
    var ua = (options && options.userAgent) || DEFAULT_UA;
    var match = ua.match(/Chrome\/(\d+)/);
    var major = match ? match[1] : DEFAULT_UA_MAJOR;
    var pathname = "/";
    try { pathname = new URL(url).pathname; } catch (_) { }
    var navigation = isNavigationRequest(method, pathname);

    var headers;
    if (navigation) {
        headers = {
            Host: url.replace("https://", "").split("/")[0],
            Connection: "keep-alive",
            "Cache-Control": "max-age=0",
            "sec-ch-ua": '"Chromium";v="' + major + '", "Google Chrome";v="' + major + '", "Not.A/Brand";v="24"',
            "sec-ch-ua-mobile": "?0",
            "sec-ch-ua-platform": '"Windows"',
            "Upgrade-Insecure-Requests": "1",
            "User-Agent": ua,
            Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
            "Sec-Fetch-Site": "none",
            "Sec-Fetch-Mode": "navigate",
            "Sec-Fetch-User": "?1",
            "Sec-Fetch-Dest": "document",
            "Accept-Encoding": "gzip, deflate",
            "Accept-Language": "vi-VN,vi;q=0.9,en-US;q=0.6,en;q=0.5"
        };
    } else {
        var m = String(method || "GET").toUpperCase();
        headers = {
            Host: url.replace("https://", "").split("/")[0],
            Connection: "keep-alive",
            "sec-ch-ua": '"Chromium";v="' + major + '", "Google Chrome";v="' + major + '", "Not.A/Brand";v="24"',
            "sec-ch-ua-mobile": "?0",
            "sec-ch-ua-platform": '"Windows"',
            "sec-ch-ua-arch": '"x86"',
            "sec-ch-ua-bitness": '"64"',
            "sec-ch-ua-full-version-list": '"Chromium";v="' + major + '.0.0.0", "Google Chrome";v="' + major + '.0.0.0", "Not.A/Brand";v="24.0.0.0"',
            "sec-ch-ua-platform-version": '"15.0.0"',
            "dpr": "1.25",
            "viewport-width": "1536",
            "priority": "u=0, i",
            "User-Agent": ua,
            Accept: "*/*",
            Origin: "https://www.facebook.com",
            Referer: "https://www.facebook.com/",
            "Sec-Fetch-Site": "same-origin",
            "Sec-Fetch-Mode": "cors",
            "Sec-Fetch-Dest": "empty",
            "X-Requested-With": "XMLHttpRequest",
            "Accept-Encoding": "gzip, deflate",
            "Accept-Language": "vi-VN,vi;q=0.9,en-US;q=0.6,en;q=0.5",
            "Cache-Control": "no-cache",
            Pragma: "no-cache"
        };
        if (m === "POST") headers["Content-Type"] = "application/x-www-form-urlencoded";
    }

    if (customHeader && typeof customHeader === "object") {
        for (var key in customHeader) {
            if (!Object.prototype.hasOwnProperty.call(customHeader, key)) continue;
            var val = customHeader[key];
            if (val === null || val === undefined || typeof val === "function") continue;
            if (typeof val === "object") continue;
            headers[key] = val;
        }
    }
    if (ctx && ctx.region) headers["X-MSGR-Region"] = ctx.region;

    var sanitized = {};
    for (var k in headers) {
        if (!Object.prototype.hasOwnProperty.call(headers, k)) continue;
        var sk = sanitizeHeaderName(k);
        var sv = sanitizeHeaderValue(headers[k]);
        if (sk && sv !== "") sanitized[sk] = sv;
    }
    return sanitized;
}

function isReadableStream(obj) {
    return (
        obj instanceof stream.Stream &&
        (getType(obj._read) === "Function" ||
            getType(obj._read) === "AsyncFunction") &&
        getType(obj._readableState) === "Object"
    );
}

function isRetryableNetworkError(err) {
    if (!err) return false;
    var code = err.code || (err.cause && err.cause.code);
    return code === "ETIMEDOUT" || code === "ESOCKETTIMEDOUT" || code === "ECONNRESET" || err.connect === true || (err.cause && err.cause.connect === true);
}

function requestWithRetry(op, retries, label) {
    retries = typeof retries === "number" ? retries : 2;
    return request(op).catch(function(err) {
        if (isRetryableNetworkError(err) && retries > 0) {
            log.warn(label || "request", "Loi mang (" + (err.code || "unknown") + "), thu lai (" + retries + " lan con)...");
            return new Promise(function(resolve) { setTimeout(resolve, 2000); })
                .then(function() { return requestWithRetry(op, retries - 1, label); });
        }
        throw err;
    });
}

function get(url, jar, qs, options, ctx) {

    if (getType(qs) === "Object")
        for (var prop in qs)
            if (qs.hasOwnProperty(prop) && getType(qs[prop]) === "Object") qs[prop] = JSON.stringify(qs[prop]);
    var op = {
        headers: getHeaders(url, options, ctx, null, "GET"),
        timeout: 60000,
        family: 4,
        qs: qs,
        url: url,
        method: "GET",
        jar: jar,
        gzip: true,
        pool: false,
        forever: false
    };

    return requestWithRetry(op, 2, "get").then(function(res) {
        return res;
    });
}

function post(url, jar, form, options, ctx, customHeader) {
    var op = {
        headers: getHeaders(url, options, ctx, customHeader, "POST"),
        timeout: 60000,
        family: 4,
        url: url,
        method: "POST",
        form: form,
        jar: jar,
        gzip: true,
        pool: false,
        forever: false
    };
    return requestWithRetry(op, 2, "post").then(function(res) {
        return res;
    });
}

function postFormData(url, jar, form, qs, options, ctx) {
    var headers = getHeaders(url, options, ctx, null, "POST");
    headers["Content-Type"] = "multipart/form-data";
    var op = {
        headers: headers,
        timeout: 120000,
        family: 4,
        url: url,
        method: "POST",
        formData: form,
        qs: qs,
        jar: jar,
        gzip: true,
        pool: false,
        forever: false
    };

    return requestWithRetry(op, 2, "postFormData").then(function(res) {
        return res;
    });
}


function padZeros(val, len) {
    val = String(val);
    len = len || 2;
    while (val.length < len) val = "0" + val;
    return val;
}

function generateThreadingID(clientID) {
    var k = Date.now();
    var l = Math.floor(Math.random() * 4294967295);
    var m = clientID;
    return "<" + k + ":" + l + "-" + m + "@mail.projektitan.com>";
}

function binaryToDecimal(data) {
    var ret = "";
    while (data !== "0") {
        var end = 0;
        var fullName = "";
        var i = 0;
        for (; i < data.length; i++) {
            end = 2 * end + parseInt(data[i], 10);
            if (end >= 10) {
                fullName += "1";
                end -= 10;
            } else fullName += "0";
        }
        ret = end.toString() + ret;
        data = fullName.slice(fullName.indexOf("1"));
    }
    return ret;
}

function generateOfflineThreadingID() {
    var ret = Date.now();
    var value = Math.floor(Math.random() * 4294967295);
    var str = ("0000000000000000000000" + value.toString(2)).slice(-22);
    var msgs = ret.toString(2) + str;
    return binaryToDecimal(msgs);
}

var h;
var i = {};
var j = {
    _: "%",
    A: "%2",
    B: "000",
    C: "%7d",
    D: "%7b%22",
    E: "%2c%22",
    F: "%22%3a",
    G: "%2c%22ut%22%3a1",
    H: "%2c%22bls%22%3a",
    I: "%2c%22n%22%3a%22%",
    J: "%22%3a%7b%22i%22%3a0%7d",
    K: "%2c%22pt%22%3a0%2c%22vis%22%3a",
    L: "%2c%22ch%22%3a%7b%22h%22%3a%22",
    M: "%7b%22v%22%3a2%2c%22time%22%3a1",
    N: ".channel%22%2c%22sub%22%3a%5b",
    O: "%2c%22sb%22%3a1%2c%22t%22%3a%5b",
    P: "%2c%22ud%22%3a100%2c%22lc%22%3a0",
    Q: "%5d%2c%22f%22%3anull%2c%22uct%22%3a",
    R: ".channel%22%2c%22sub%22%3a%5b1%5d",
    S: "%22%2c%22m%22%3a0%7d%2c%7b%22i%22%3a",
    T: "%2c%22blc%22%3a1%2c%22snd%22%3a1%2c%22ct%22%3a",
    U: "%2c%22blc%22%3a0%2c%22snd%22%3a1%2c%22ct%22%3a",
    V: "%2c%22blc%22%3a0%2c%22snd%22%3a0%2c%22ct%22%3a",
    W: "%2c%22s%22%3a0%2c%22blo%22%3a0%7d%2c%22bl%22%3a%7b%22ac%22%3a",
    X: "%2c%22ri%22%3a0%7d%2c%22state%22%3a%7b%22p%22%3a0%2c%22ut%22%3a1",
    Y: "%2c%22pt%22%3a0%2c%22vis%22%3a1%2c%22bls%22%3a0%2c%22blc%22%3a0%2c%22snd%22%3a1%2c%22ct%22%3a",
    Z: "%2c%22sb%22%3a1%2c%22t%22%3a%5b%5d%2c%22f%22%3anull%2c%22uct%22%3a0%2c%22s%22%3a0%2c%22blo%22%3a0%7d%2c%22bl%22%3a%7b%22ac%22%3a"
};
(function() {
    var l = [];
    for (var m in j) {
        i[j[m]] = m;
        l.push(j[m]);
    }
    l.reverse();
    h = new RegExp(l.join("|"), "g");
})();

function presenceEncode(str) {
    return encodeURIComponent(str)
        .replace(/([_A-Z])|%../g, function(m, n) {
            return n ? "%" + n.charCodeAt(0).toString(16) : m;
        })
        .toLowerCase()
        .replace(h, function(m) {
            return i[m];
        });
}

function presenceDecode(str) {
    return decodeURIComponent(
        str.replace(/[_A-Z]/g, function(m) {
            return j[m];
        })
    );
}

function generatePresence(userID) {
    var time = Date.now();
    return (
        "E" +
        presenceEncode(
            JSON.stringify({
                v: 3,
                time: parseInt(time / 1000, 10),
                user: userID,
                state: {
                    ut: 0,
                    t2: [],
                    lm2: null,
                    uct2: time,
                    tr: null,
                    tw: Math.floor(Math.random() * 4294967295) + 1,
                    at: time
                },
                ch: {
                    ["p_" + userID]: 0
                }
            })
        )
    );
}

function generateAccessiblityCookie() {
    var time = Date.now();
    return encodeURIComponent(
        JSON.stringify({
            sr: 0,
            "sr-ts": time,
            jk: 0,
            "jk-ts": time,
            kb: 0,
            "kb-ts": time,
            hcm: 0,
            "hcm-ts": time
        })
    );
}

function getGUID() {

    var sectionLength = Date.now();

    var id = "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function(c) {

        var r = Math.floor((sectionLength + Math.random() * 16) % 16);

        sectionLength = Math.floor(sectionLength / 16);

        var _guid = (c == "x" ? r : (r & 7) | 8).toString(16);
        return _guid;
    });
    return id;
}

function _formatAttachment(attachment1, attachment2) {

    attachment2 = attachment2 || { id: "", image_data: {} };
    attachment1 = attachment1.mercury ? attachment1.mercury : attachment1;
    var blob = attachment1.blob_attachment;
    var type =
        blob && blob.__typename ? blob.__typename : attachment1.attach_type;
    if (!type && attachment1.sticker_attachment) {
        type = "StickerAttachment";
        blob = attachment1.sticker_attachment;
    } else if (!type && attachment1.extensible_attachment) {
        if (
            attachment1.extensible_attachment.story_attachment &&
            attachment1.extensible_attachment.story_attachment.target &&
            attachment1.extensible_attachment.story_attachment.target.__typename &&
            attachment1.extensible_attachment.story_attachment.target.__typename === "MessageLocation"
        ) type = "MessageLocation";
        else type = "ExtensibleAttachment";

        blob = attachment1.extensible_attachment;
    }

    switch (type) {
        case "sticker":
            return {
                type: "sticker",
                ID: attachment1.metadata.stickerID.toString(),
                url: attachment1.url,

                packID: attachment1.metadata.packID.toString(),
                spriteUrl: attachment1.metadata.spriteURI,
                spriteUrl2x: attachment1.metadata.spriteURI2x,
                width: attachment1.metadata.width,
                height: attachment1.metadata.height,

                caption: attachment2.caption,
                description: attachment2.description,

                frameCount: attachment1.metadata.frameCount,
                frameRate: attachment1.metadata.frameRate,
                framesPerRow: attachment1.metadata.framesPerRow,
                framesPerCol: attachment1.metadata.framesPerCol,

                stickerID: attachment1.metadata.stickerID.toString(),
                spriteURI: attachment1.metadata.spriteURI,
                spriteURI2x: attachment1.metadata.spriteURI2x
            };
        case "file":
            return {
                type: "file",
                filename: attachment1.name,
                ID: attachment2.id.toString(),
                url: attachment1.url,

                isMalicious: attachment2.is_malicious,
                contentType: attachment2.mime_type,

                name: attachment1.name,
                mimeType: attachment2.mime_type,
                fileSize: attachment2.file_size
            };
        case "photo":
            return {
                type: "photo",
                ID: attachment1.metadata.fbid.toString(),
                filename: attachment1.fileName,
                thumbnailUrl: attachment1.thumbnail_url,

                previewUrl: attachment1.preview_url,
                previewWidth: attachment1.preview_width,
                previewHeight: attachment1.preview_height,

                largePreviewUrl: attachment1.large_preview_url,
                largePreviewWidth: attachment1.large_preview_width,
                largePreviewHeight: attachment1.large_preview_height,

                url: attachment1.metadata.url,
                width: attachment1.metadata.dimensions.split(",")[0],
                height: attachment1.metadata.dimensions.split(",")[1],
                name: attachment1.fileName
            };
        case "animated_image":
            return {
                type: "animated_image",
                ID: attachment2.id.toString(),
                filename: attachment2.filename,

                previewUrl: attachment1.preview_url,
                previewWidth: attachment1.preview_width,
                previewHeight: attachment1.preview_height,

                url: attachment2.image_data.url,
                width: attachment2.image_data.width,
                height: attachment2.image_data.height,

                name: attachment1.name,
                facebookUrl: attachment1.url,
                thumbnailUrl: attachment1.thumbnail_url,
                mimeType: attachment2.mime_type,
                rawGifImage: attachment2.image_data.raw_gif_image,
                rawWebpImage: attachment2.image_data.raw_webp_image,
                animatedGifUrl: attachment2.image_data.animated_gif_url,
                animatedGifPreviewUrl: attachment2.image_data.animated_gif_preview_url,
                animatedWebpUrl: attachment2.image_data.animated_webp_url,
                animatedWebpPreviewUrl: attachment2.image_data.animated_webp_preview_url
            };
        case "share":
            return {
                type: "share",
                ID: attachment1.share.share_id.toString(),
                url: attachment2.href,

                title: attachment1.share.title,
                description: attachment1.share.description,
                source: attachment1.share.source,

                image: attachment1.share.media.image,
                width: attachment1.share.media.image_size.width,
                height: attachment1.share.media.image_size.height,
                playable: attachment1.share.media.playable,
                duration: attachment1.share.media.duration,

                subattachments: attachment1.share.subattachments,
                properties: {},

                animatedImageSize: attachment1.share.media.animated_image_size,
                facebookUrl: attachment1.share.uri,
                target: attachment1.share.target,
                styleList: attachment1.share.style_list
            };
        case "video":
            return {
                type: "video",
                ID: attachment1.metadata.fbid.toString(),
                filename: attachment1.name,

                previewUrl: attachment1.preview_url,
                previewWidth: attachment1.preview_width,
                previewHeight: attachment1.preview_height,

                url: attachment1.url,
                width: attachment1.metadata.dimensions.width,
                height: attachment1.metadata.dimensions.height,

                duration: attachment1.metadata.duration,
                videoType: "unknown",

                thumbnailUrl: attachment1.thumbnail_url
            };
        case "error":
            return {
                type: "error",

                attachment1: attachment1,
                attachment2: attachment2
            };
        case "MessageImage":
            return {
                type: "photo",
                ID: blob.legacy_attachment_id,
                filename: blob.filename,
                thumbnailUrl: blob.thumbnail.uri,

                previewUrl: blob.preview.uri,
                previewWidth: blob.preview.width,
                previewHeight: blob.preview.height,

                largePreviewUrl: blob.large_preview.uri,
                largePreviewWidth: blob.large_preview.width,
                largePreviewHeight: blob.large_preview.height,

                url: blob.large_preview.uri,
                width: blob.original_dimensions.x,
                height: blob.original_dimensions.y,
                name: blob.filename
            };
        case "MessageAnimatedImage":
            return {
                type: "animated_image",
                ID: blob.legacy_attachment_id,
                filename: blob.filename,

                previewUrl: blob.preview_image.uri,
                previewWidth: blob.preview_image.width,
                previewHeight: blob.preview_image.height,

                url: blob.animated_image.uri,
                width: blob.animated_image.width,
                height: blob.animated_image.height,

                thumbnailUrl: blob.preview_image.uri,
                name: blob.filename,
                facebookUrl: blob.animated_image.uri,
                rawGifImage: blob.animated_image.uri,
                animatedGifUrl: blob.animated_image.uri,
                animatedGifPreviewUrl: blob.preview_image.uri,
                animatedWebpUrl: blob.animated_image.uri,
                animatedWebpPreviewUrl: blob.preview_image.uri
            };
        case "MessageVideo":
            return {
                type: "video",
                filename: blob.filename,
                ID: blob.legacy_attachment_id,

                previewUrl: blob.large_image.uri,
                previewWidth: blob.large_image.width,
                previewHeight: blob.large_image.height,

                url: blob.playable_url,
                width: blob.original_dimensions.x,
                height: blob.original_dimensions.y,

                duration: blob.playable_duration_in_ms,
                videoType: blob.video_type.toLowerCase(),

                thumbnailUrl: blob.large_image.uri
            };
        case "MessageAudio":
            return {
                type: "audio",
                filename: blob.filename,
                ID: blob.url_shimhash,

                audioType: blob.audio_type,
                duration: blob.playable_duration_in_ms,
                url: blob.playable_url,

                isVoiceMail: blob.is_voicemail
            };
        case "StickerAttachment":
            return {
                type: "sticker",
                ID: blob.id,
                url: blob.url,

                packID: blob.pack ? blob.pack.id : null,
                spriteUrl: blob.sprite_image,
                spriteUrl2x: blob.sprite_image_2x,
                width: blob.width,
                height: blob.height,

                caption: blob.label,
                description: blob.label,

                frameCount: blob.frame_count,
                frameRate: blob.frame_rate,
                framesPerRow: blob.frames_per_row,
                framesPerCol: blob.frames_per_column,

                stickerID: blob.id,
                spriteURI: blob.sprite_image,
                spriteURI2x: blob.sprite_image_2x
            };
        case "MessageLocation":
            var urlAttach = blob.story_attachment.url;
            var mediaAttach = blob.story_attachment.media;

            var u = querystring.parse(url.parse(urlAttach).query).u;
            var where1 = querystring.parse(url.parse(u).query).where1;
            var address = where1.split(", ");

            var latitude;
            var longitude;

            try {
                latitude = Number.parseFloat(address[0]);
                longitude = Number.parseFloat(address[1]);
            } catch (err) {

            }

            var imageUrl;
            var width;
            var height;

            if (mediaAttach && mediaAttach.image) {
                imageUrl = mediaAttach.image.uri;
                width = mediaAttach.image.width;
                height = mediaAttach.image.height;
            }

            return {
                type: "location",
                ID: blob.legacy_attachment_id,
                latitude: latitude,
                longitude: longitude,
                image: imageUrl,
                width: width,
                height: height,
                url: u || urlAttach,
                address: where1,

                facebookUrl: blob.story_attachment.url,
                target: blob.story_attachment.target,
                styleList: blob.story_attachment.style_list
            };
        case "ExtensibleAttachment":
            return {
                type: "share",
                ID: blob.legacy_attachment_id,
                url: blob.story_attachment.url,

                title: blob.story_attachment.title_with_entities.text,
                description: blob.story_attachment.description &&
                    blob.story_attachment.description.text,
                source: blob.story_attachment.source ? blob.story_attachment.source.text : null,

                image: blob.story_attachment.media &&
                    blob.story_attachment.media.image &&
                    blob.story_attachment.media.image.uri,
                width: blob.story_attachment.media &&
                    blob.story_attachment.media.image &&
                    blob.story_attachment.media.image.width,
                height: blob.story_attachment.media &&
                    blob.story_attachment.media.image &&
                    blob.story_attachment.media.image.height,
                playable: blob.story_attachment.media &&
                    blob.story_attachment.media.is_playable,
                duration: blob.story_attachment.media &&
                    blob.story_attachment.media.playable_duration_in_ms,
                playableUrl: blob.story_attachment.media == null ? null : blob.story_attachment.media.playable_url,

                subattachments: blob.story_attachment.subattachments,
                properties: blob.story_attachment.properties.reduce(function(obj, cur) {
                    obj[cur.key] = cur.value.text;
                    return obj;
                }, {}),

                facebookUrl: blob.story_attachment.url,
                target: blob.story_attachment.target,
                styleList: blob.story_attachment.style_list
            };
        case "MessageFile":
            return {
                type: "file",
                filename: blob.filename,
                ID: blob.message_file_fbid,

                url: blob.url,
                isMalicious: blob.is_malicious,
                contentType: blob.content_type,

                name: blob.filename,
                mimeType: "",
                fileSize: -1
            };
        default:
            throw new Error(
                "unrecognized attach_file of type " +
                type +
                "`" +
                JSON.stringify(attachment1, null, 4) +
                " attachment2: " +
                JSON.stringify(attachment2, null, 4) +
                "`"
            );
    }
}

function formatAttachment(attachments, attachmentIds, attachmentMap, shareMap) {
    attachmentMap = shareMap || attachmentMap;
    return attachments ?
        attachments.map(function(val, i) {
            if (!attachmentMap ||
                !attachmentIds ||
                !attachmentMap[attachmentIds[i]]
            ) {
                return _formatAttachment(val);
            }
            return _formatAttachment(val, attachmentMap[attachmentIds[i]]);
        }) : [];
}

function formatDeltaMessage(m) {
    var md = m.messageMetadata;
    var body = m.body || "";
    var mdata = m.data?.prng ? JSON.parse(m.data.prng) : [];
    var mentions = {};

    if (Array.isArray(mdata) && mdata.length > 0) {
        for (var i = 0; i < mdata.length; i++) {
            mentions[mdata[i].i] = body.substring(mdata[i].o, mdata[i].o + mdata[i].l);
        }
    } else {
        try {
            const g = md?.data?.data?.Gb?.asMap?.data || md?.data?.Gb?.asMap?.data;
            if (g) {
                for (const key in g) {
                     const val = g[key]?.asMap?.data || g[key];
                     if (val?.id?.asLong && val?.offset?.asLong != null && val?.length?.asLong != null) {
                         const offset = parseInt(val.offset.asLong);
                         const length = parseInt(val.length.asLong);
                         mentions[val.id.asLong] = body.substring(offset, offset + length);
                     }
                }
            }
        } catch (e) {
            log.error("formatDeltaMessage", "Error parsing mentions", e);
        }
    }

    var args = body == "" ? [] : body.trim().split(/\s+/);

    return {
        type: "message",
        senderID: formatID(md.actorFbId.toString()),
        threadID: formatID((md.threadKey.threadFbId || md.threadKey.otherUserFbId).toString()),
        messageID: md.messageId,
        args: args,
        body: body,
        attachments: (m.attachments || []).map((v) => _formatAttachment(v)),
        mentions: mentions,
        timestamp: md.timestamp,
        isGroup: !!md.threadKey.threadFbId,
        participantIDs: m.participants || []
    };
}

function formatID(id) {
    if (id != undefined && id != null) return String(id).replace(/(fb)?id[:.]/, "");
    else return id;
}

function formatMessage(m) {
    var originalMessage = m.message ? m.message : m;
    var obj = {
        type: "message",
        senderName: originalMessage.sender_name,
        senderID: formatID(originalMessage.sender_fbid.toString()),
        participantNames: originalMessage.group_thread_info ? originalMessage.group_thread_info.participant_names : [originalMessage.sender_name.split(" ")[0]],
        participantIDs: originalMessage.group_thread_info ?
            originalMessage.group_thread_info.participant_ids.map(function(v) {
                return formatID(v.toString());
            }) : [formatID(originalMessage.sender_fbid)],
        body: originalMessage.body || "",
        threadID: formatID((originalMessage.thread_fbid || originalMessage.other_user_fbid).toString()),
        threadName: originalMessage.group_thread_info ? originalMessage.group_thread_info.name : originalMessage.sender_name,
        location: originalMessage.coordinates ? originalMessage.coordinates : null,
        messageID: originalMessage.mid ? originalMessage.mid.toString() : originalMessage.message_id,
        attachments: formatAttachment(
            originalMessage.attachments,
            originalMessage.attachmentIds,
            originalMessage.attachment_map,
            originalMessage.share_map
        ),
        timestamp: originalMessage.timestamp,
        timestampAbsolute: originalMessage.timestamp_absolute,
        timestampRelative: originalMessage.timestamp_relative,
        timestampDatetime: originalMessage.timestamp_datetime,
        tags: originalMessage.tags,
        reactions: originalMessage.reactions ? originalMessage.reactions : [],
        isUnread: originalMessage.is_unread
    };

    if (m.type === "pages_messaging") obj.pageID = m.realtime_viewer_fbid.toString();
    obj.isGroup = obj.participantIDs.length > 2;

    return obj;
}

function formatEvent(m) {
    var originalMessage = m.message ? m.message : m;
    var logMessageType = originalMessage.log_message_type;
    var logMessageData;
    if (logMessageType === "log:generic-admin-text") {
        logMessageData = originalMessage.log_message_data.untypedData;
        logMessageType = getAdminTextMessageType(originalMessage.log_message_data.message_type);
    } else logMessageData = originalMessage.log_message_data;

    return Object.assign(formatMessage(originalMessage), {
        type: "event",
        logMessageType: logMessageType,
        logMessageData: logMessageData,
        logMessageBody: originalMessage.log_message_body
    });
}

function formatHistoryMessage(m) {
    switch (m.action_type) {
        case "ma-type:log-message":
            return formatEvent(m);
        default:
            return formatMessage(m);
    }
}

function getAdminTextMessageType(m) {
    switch (m.type) {
        case "joinable_group_link_mode_change":
            return "log:link-status";
        case "magic_words":
            return "log:magic-words";
        case "change_thread_theme":
            return "log:thread-color";
        case "change_thread_icon":
        case "change_thread_quick_reaction":
            return "log:thread-icon";
        case "change_thread_nickname":
            return "log:user-nickname";
        case "change_thread_admins":
            return "log:thread-admins";
        case "group_poll":
            return "log:thread-poll";
        case "change_thread_approval_mode":
            return "log:thread-approval-mode";
        case "messenger_call_log":
        case "participant_joined_group_call":
            return "log:thread-call";
        case "pin_messages_v2":
            return "log:thread-pinned";
    }
}

function getGenderByPhysicalMethod(name) {
  const female_name = [
    "Phương Chi",
    "An Bình",
    "An Di",
    "An Hạ",
    "An Hằng",
    "An Khê",
    "An Nhiên",
    "An Nhàn",
    "Anh Chi",
    "Anh Hương",
    "Anh Mai",
    "Anh Phương",
    "Anh Thi",
    "Anh Thy",
    "Anh Thơ",
    "Anh Thư",
    "Anh Thảo",
    "Anh Vũ",
    "Anh Ðào",
    "Ban Mai",
    "Bình Minh",
    "Bình Yên",
    "Bích Chiêu",
    "Bích Châu",
    "Bích Duyên",
    "Bích Hiền",
    "Bích Huệ",
    "Bích Hà",
    "Bích Hạnh",
    "Bích Hải",
    "Bích Hảo",
    "Bích Hậu",
    "Bích Hằng",
    "Bích Hồng",
    "Bích Hợp",
    "Bích Lam",
    "Bích Liên",
    "Bích Loan",
    "Bích Nga",
    "Bích Ngà",
    "Bích Ngân",
    "Bích Ngọc",
    "Bích Như",
    "Bích Phượng",
    "Bích Quyên",
    "Bích Quân",
    "Bích San",
    "Bích Thoa",
    "Bích Thu",
    "Bích Thảo",
    "Bích Thủy",
    "Bích Trang",
    "Bích Trâm",
    "Bích Ty",
    "Bích Vân",
    "Bích Ðiệp",
    "Bích Ðào",
    "Băng Băng",
    "Băng Tâm",
    "Bạch Cúc",
    "Bạch Hoa",
    "Bạch Kim",
    "Bạch Liên",
    "Bạch Loan",
    "Bạch Mai",
    "Bạch Quỳnh",
    "Bạch Trà",
    "Bạch Tuyết",
    "Bạch Vân",
    "Bạch Yến",
    "Bảo Anh",
    "Bảo Bình",
    "Bảo Châu",
    "Bảo Huệ",
    "Bảo Hà",
    "Bảo Hân",
    "Bảo Lan",
    "Bảo Lễ",
    "Bảo Ngọc",
    "Bảo Phương",
    "Bảo Quyên",
    "Bảo Quỳnh",
    "Bảo Thoa",
    "Bảo Thúy",
    "Bảo Tiên",
    "Bảo Trâm",
    "Bảo Trân",
    "Bảo Trúc",
    "Bảo Uyên",
    "Bảo Vy",
    "Bảo Vân",
    "Bội Linh",
    "Cam Thảo",
    "Chi Lan",
    "Chi Mai",
    "Chiêu Dương",
    "Cát Cát",
    "Cát Linh",
    "Cát Ly",
    "Cát Tiên",
    "Cát Tường",
    "Cẩm Hiền",
    "Cẩm Hường",
    "Cẩm Hạnh",
    "Cẩm Linh",
    "Cẩm Liên",
    "Cẩm Ly",
    "Cẩm Nhi",
    "Cẩm Nhung",
    "Cẩm Thúy",
    "Cẩm Tú",
    "Cẩm Vân",
    "Cẩm Yến",
    "Di Nhiên",
    "Diên Vỹ",
    "Diễm Chi",
    "Diễm Châu",
    "Diễm Hương",
    "Diễm Hạnh",
    "Diễm Hằng",
    "Diễm Khuê",
    "Diễm Kiều",
    "Diễm Liên",
    "Diễm Lộc",
    "Diễm My",
    "Diễm Phúc",
    "Diễm Phương",
    "Diễm Phước",
    "Diễm Phượng",
    "Diễm Quyên",
    "Diễm Quỳnh",
    "Diễm Thúy",
    "Diễm Thư",
    "Diễm Thảo",
    "Diễm Trang",
    "Diễm Trinh",
    "Diễm Uyên",
    "Diệp Anh",
    "Diệp Vy",
    "Diệu Anh",
    "Diệu Hiền",
    "Diệu Hoa",
    "Diệu Huyền",
    "Diệu Hương",
    "Diệu Hạnh",
    "Diệu Hằng",
    "Diệu Hồng",
    "Diệu Lan",
    "Diệu Linh",
    "Diệu Loan",
    "Diệu Nga",
    "Diệu Ngà",
    "Diệu Ngọc",
    "Diệu Nương",
    "Diệu Thiện",
    "Diệu Thúy",
    "Diệu Vân",
    "Diệu Ái",
    "Duy Hạnh",
    "Duy Mỹ",
    "Duy Uyên",
    "Duyên Hồng",
    "Duyên My",
    "Duyên Mỹ",
    "Duyên Nương",
    "Dã Lan",
    "Dã Lâm",
    "Dã Thảo",
    "Dạ Hương",
    "Dạ Lan",
    "Dạ Nguyệt",
    "Dạ Thi",
    "Dạ Thảo",
    "Dạ Yến",
    "Gia Hân",
    "Gia Khanh",
    "Gia Linh",
    "Gia Nhi",
    "Gia Quỳnh",
    "Giang Thanh",
    "Giang Thiên",
    "Giao Hưởng",
    "Giao Kiều",
    "Giao Linh",
    "Giáng Ngọc",
    "Giáng Tiên",
    "Giáng Uyên",
    "Hiếu Giang",
    "Hiếu Hạnh",
    "Hiếu Khanh",
    "Hiếu Minh",
    "Hiền Chung",
    "Hiền Hòa",
    "Hiền Mai",
    "Hiền Nhi",
    "Hiền Nương",
    "Hiền Thục",
    "Hiểu Lam",
    "Hiểu Vân",
    "Hoa Liên",
    "Hoa Lý",
    "Hoa Thiên",
    "Hoa Tiên",
    "Hoa Tranh",
    "Hoài An",
    "Hoài Giang",
    "Hoài Hương",
    "Hoài Phương",
    "Hoài Thương",
    "Hoài Trang",
    "Hoài Vỹ",
    "Hoàn Châu",
    "Hoàn Vi",
    "Hoàng Cúc",
    "Hoàng Hà",
    "Hoàng Kim",
    "Hoàng Lan",
    "Hoàng Mai",
    "Hoàng Miên",
    "Hoàng Nguyên",
    "Hoàng Oanh",
    "Hoàng Sa",
    "Hoàng Thư",
    "Hoàng Xuân",
    "Hoàng Yến",
    "Hoạ Mi",
    "Huyền Anh",
    "Huyền Diệu",
    "Huyền Linh",
    "Huyền Ngọc",
    "Huyền Nhi",
    "Huyền Thoại",
    "Huyền Thư",
    "Huyền Trang",
    "Huyền Trâm",
    "Huyền Trân",
    "Huệ An",
    "Huệ Hương",
    "Huệ Hồng",
    "Huệ Lan",
    "Huệ Linh",
    "Huệ Lâm",
    "Huệ My",
    "Huệ Phương",
    "Huệ Thương",
    "Huệ Ân",
    "Huỳnh Anh",
    "Hà Giang",
    "Hà Liên",
    "Hà Mi",
    "Hà My",
    "Hà Nhi",
    "Hà Phương",
    "Hà Thanh",
    "Hà Tiên",
    "Hàm Duyên",
    "Hàm Nghi",
    "Hàm Thơ",
    "Hàm Ý",
    "Hương Chi",
    "Hương Giang",
    "Hương Lan",
    "Hương Liên",
    "Hương Ly",
    "Hương Lâm",
    "Hương Mai",
    "Hương Nhi",
    "Hương Thu",
    "Hương Thảo",
    "Hương Thủy",
    "Hương Tiên",
    "Hương Trang",
    "Hương Trà",
    "Hương Xuân",
    "Hướng Dương",
    "Hạ Băng",
    "Hạ Giang",
    "Hạ Phương",
    "Hạ Tiên",
    "Hạ Uyên",
    "Hạ Vy",
    "Hạc Cúc",
    "Hạnh Chi",
    "Hạnh Dung",
    "Hạnh Linh",
    "Hạnh My",
    "Hạnh Nga",
    "Hạnh Nhơn",
    "Hạnh Phương",
    "Hạnh San",
    "Hạnh Thảo",
    "Hạnh Trang",
    "Hạnh Vi",
    "Hải Anh",
    "Hải Châu",
    "Hải Duyên",
    "Hải Dương",
    "Hải Miên",
    "Hải My",
    "Hải Mỹ",
    "Hải Ngân",
    "Hải Nhi",
    "Hải Phương",
    "Hải Phượng",
    "Hải San",
    "Hải Sinh",
    "Hải Thanh",
    "Hải Thảo",
    "Hải Thụy",
    "Hải Uyên",
    "Hải Vy",
    "Hải Vân",
    "Hải Yến",
    "Hải Ân",
    "Hải Ðường",
    "Hảo Nhi",
    "Hằng Anh",
    "Hằng Nga",
    "Họa Mi",
    "Hồ Diệp",
    "Hồng Anh",
    "Hồng Bạch Thảo",
    "Hồng Châu",
    "Hồng Diễm",
    "Hồng Giang",
    "Hồng Hoa",
    "Hồng Hà",
    "Hồng Hạnh",
    "Hồng Khanh",
    "Hồng Khuê",
    "Hồng Khôi",
    "Hồng Linh",
    "Hồng Liên",
    "Hồng Lâm",
    "Hồng Mai",
    "Hồng Nga",
    "Hồng Ngân",
    "Hồng Ngọc",
    "Hồng Nhung",
    "Hồng Như",
    "Hồng Nhạn",
    "Hồng Oanh",
    "Hồng Phúc",
    "Hồng Phương",
    "Hồng Quế",
    "Hồng Thu",
    "Hồng Thúy",
    "Hồng Thư",
    "Hồng Thảo",
    "Hồng Thắm",
    "Hồng Thủy",
    "Hồng Trúc",
    "Hồng Tâm",
    "Hồng Vân",
    "Hồng Xuân",
    "Hồng Ðiệp",
    "Hồng Ðào",
    "Hồng Đăng",
    "Khiết Linh",
    "Khiết Tâm",
    "Khuê Trung",
    "Khánh Chi",
    "Khánh Giang",
    "Khánh Giao",
    "Khánh Huyền",
    "Khánh Hà",
    "Khánh Hằng",
    "Khánh Linh",
    "Khánh Ly",
    "Khánh Mai",
    "Khánh My",
    "Khánh Ngân",
    "Khánh Ngọc",
    "Khánh Quyên",
    "Khánh Quỳnh",
    "Khánh Thủy",
    "Khánh Trang",
    "Khánh Vi",
    "Khánh Vy",
    "Khánh Vân",
    "Khúc Lan",
    "Khả Khanh",
    "Khả Tú",
    "Khả Ái",
    "Khải Ca",
    "Khải Hà",
    "Khải Tâm",
    "Kim Anh",
    "Kim Chi",
    "Kim Cương",
    "Kim Dung",
    "Kim Duyên",
    "Kim Hoa",
    "Kim Hương",
    "Kim Khanh",
    "Kim Khuyên",
    "Kim Khánh",
    "Kim Lan",
    "Kim Liên",
    "Kim Loan",
    "Kim Ly",
    "Kim Mai",
    "Kim Ngân",
    "Kim Ngọc",
    "Kim Oanh",
    "Kim Phượng",
    "Kim Quyên",
    "Kim Sa",
    "Kim Thanh",
    "Kim Thoa",
    "Kim Thu",
    "Kim Thy",
    "Kim Thông",
    "Kim Thư",
    "Kim Thảo",
    "Kim Thủy",
    "Kim Trang",
    "Kim Tuyến",
    "Kim Tuyết",
    "Kim Tuyền",
    "Kim Xuyến",
    "Kim Xuân",
    "Kim Yến",
    "Kim Ánh",
    "Kim Đan",
    "Kiết Hồng",
    "Kiết Trinh",
    "Kiều Anh",
    "Kiều Diễm",
    "Kiều Dung",
    "Kiều Giang",
    "Kiều Hoa",
    "Kiều Hạnh",
    "Kiều Khanh",
    "Kiều Loan",
    "Kiều Mai",
    "Kiều Minh",
    "Kiều Mỹ",
    "Kiều Nga",
    "Kiều Nguyệt",
    "Kiều Nương",
    "Kiều Thu",
    "Kiều Trang",
    "Kiều Trinh",
    "Kỳ Anh",
    "Kỳ Diệu",
    "Kỳ Duyên",
    "Lam Giang",
    "Lam Hà",
    "Lam Khê",
    "Lam Ngọc",
    "Lam Tuyền",
    "Lan Anh",
    "Lan Chi",
    "Lan Hương",
    "Lan Khuê",
    "Lan Ngọc",
    "Lan Nhi",
    "Lan Phương",
    "Lan Thương",
    "Lan Trúc",
    "Lan Vy",
    "Linh Chi",
    "Linh Châu",
    "Linh Duyên",
    "Linh Giang",
    "Linh Hà",
    "Linh Lan",
    "Linh Nhi",
    "Linh Phương",
    "Linh Phượng",
    "Linh San",
    "Linh Trang",
    "Linh Ðan",
    "Liên Chi",
    "Liên Hoa",
    "Liên Hương",
    "Liên Như",
    "Liên Phương",
    "Liên Trân",
    "Liễu Oanh",
    "Loan Châu",
    "Ly Châu",
    "Lâm Nhi",
    "Lâm Oanh",
    "Lâm Tuyền",
    "Lâm Uyên",
    "Lê Quỳnh",
    "Lưu Ly",
    "Lệ Băng",
    "Lệ Chi",
    "Lệ Giang",
    "Lệ Hoa",
    "Lệ Huyền",
    "Lệ Khanh",
    "Lệ Nga",
    "Lệ Nhi",
    "Lệ Quyên",
    "Lệ Quân",
    "Lệ Thanh",
    "Lệ Thu",
    "Lệ Thủy",
    "Lộc Uyên",
    "Lộc Uyển",
    "Lục Bình",
    "Mai Anh",
    "Mai Chi",
    "Mai Châu",
    "Mai Hiền",
    "Mai Hà",
    "Mai Hương",
    "Mai Hạ",
    "Mai Khanh",
    "Mai Khôi",
    "Mai Lan",
    "Mai Linh",
    "Mai Liên",
    "Mai Loan",
    "Mai Ly",
    "Mai Nhi",
    "Mai Phương",
    "Mai Quyên",
    "Mai Thanh",
    "Mai Thu",
    "Mai Thy",
    "Mai Thảo",
    "Mai Trinh",
    "Mai Tâm",
    "Mai Vy",
    "Minh An",
    "Minh Châu",
    "Minh Duyên",
    "Minh Hiền",
    "Minh Huyền",
    "Minh Huệ",
    "Minh Hà",
    "Minh Hương",
    "Minh Hạnh",
    "Minh Hằng",
    "Minh Hồng",
    "Minh Khai",
    "Minh Khuê",
    "Minh Loan",
    "Minh Minh",
    "Minh Nguyệt",
    "Minh Ngọc",
    "Minh Nhi",
    "Minh Như",
    "Minh Phương",
    "Minh Phượng",
    "Minh Thu",
    "Minh Thúy",
    "Minh Thư",
    "Minh Thương",
    "Minh Thảo",
    "Minh Thủy",
    "Minh Trang",
    "Minh Tuyết",
    "Minh Tuệ",
    "Minh Tâm",
    "Minh Uyên",
    "Minh Vy",
    "Minh Xuân",
    "Minh Yến",
    "Minh Đan",
    "Mậu Xuân",
    "Mộc Miên",
    "Mộng Hoa",
    "Mộng Hương",
    "Mộng Hằng",
    "Mộng Lan",
    "Mộng Liễu",
    "Mộng Nguyệt",
    "Mộng Nhi",
    "Mộng Quỳnh",
    "Mộng Thi",
    "Mộng Thu",
    "Mộng Tuyền",
    "Mộng Vi",
    "Mộng Vy",
    "Mộng Vân",
    "Mộng Ðiệp",
    "Mỹ Anh",
    "Mỹ Diễm",
    "Mỹ Dung",
    "Mỹ Duyên",
    "Mỹ Hiệp",
    "Mỹ Hoàn",
    "Mỹ Huyền",
    "Mỹ Huệ",
    "Mỹ Hường",
    "Mỹ Hạnh",
    "Mỹ Khuyên",
    "Mỹ Kiều",
    "Mỹ Lan",
    "Mỹ Loan",
    "Mỹ Lệ",
    "Mỹ Lợi",
    "Mỹ Nga",
    "Mỹ Ngọc",
    "Mỹ Nhi",
    "Mỹ Nhân",
    "Mỹ Nương",
    "Mỹ Phương",
    "Mỹ Phượng",
    "Mỹ Phụng",
    "Mỹ Thuần",
    "Mỹ Thuận",
    "Mỹ Trang",
    "Mỹ Trâm",
    "Mỹ Tâm",
    "Mỹ Uyên",
    "Mỹ Vân",
    "Mỹ Xuân",
    "Mỹ Yến",
    "Nghi Dung",
    "Nghi Minh",
    "Nghi Xuân",
    "Nguyên Hồng",
    "Nguyên Thảo",
    "Nguyết Ánh",
    "Nguyệt Anh",
    "Nguyệt Cát",
    "Nguyệt Cầm",
    "Nguyệt Hà",
    "Nguyệt Hồng",
    "Nguyệt Lan",
    "Nguyệt Minh",
    "Nguyệt Nga",
    "Nguyệt Quế",
    "Nguyệt Uyển",
    "Nguyệt Ánh",
    "Ngân Anh",
    "Ngân Hà",
    "Ngân Thanh",
    "Ngân Trúc",
    "Ngọc Anh",
    "Ngọc Bích",
    "Ngọc Cầm",
    "Ngọc Diệp",
    "Ngọc Dung",
    "Ngọc Hiền",
    "Ngọc Hoa",
    "Ngọc Hoan",
    "Ngọc Hoàn",
    "Ngọc Huyền",
    "Ngọc Huệ",
    "Ngọc Hà",
    "Ngọc Hân",
    "Ngọc Hạ",
    "Ngọc Hạnh",
    "Ngọc Hằng",
    "Ngọc Khanh",
    "Ngọc Khuê",
    "Ngọc Khánh",
    "Ngọc Lam",
    "Ngọc Lan",
    "Ngọc Linh",
    "Ngọc Liên",
    "Ngọc Loan",
    "Ngọc Ly",
    "Ngọc Lâm",
    "Ngọc Lý",
    "Ngọc Lệ",
    "Ngọc Mai",
    "Ngọc Nhi",
    "Ngọc Nữ",
    "Ngọc Oanh",
    "Ngọc Phụng",
    "Ngọc Quyên",
    "Ngọc Quế",
    "Ngọc Quỳnh",
    "Ngọc San",
    "Ngọc Sương",
    "Ngọc Thi",
    "Ngọc Thy",
    "Ngọc Thơ",
    "Ngọc Trinh",
    "Ngọc Trâm",
    "Ngọc Tuyết",
    "Ngọc Tâm",
    "Ngọc Tú",
    "Ngọc Uyên",
    "Ngọc Uyển",
    "Ngọc Vy",
    "Ngọc Vân",
    "Ngọc Yến",
    "Ngọc Ái",
    "Ngọc Ánh",
    "Ngọc Ðiệp",
    "Ngọc Ðàn",
    "Ngọc Ðào",
    "Nhan Hồng",
    "Nhã Hương",
    "Nhã Hồng",
    "Nhã Khanh",
    "Nhã Lý",
    "Nhã Mai",
    "Nhã Sương",
    "Nhã Thanh",
    "Nhã Trang",
    "Nhã Trúc",
    "Nhã Uyên",
    "Nhã Yến",
    "Nhã Ý",
    "Như Anh",
    "Như Bảo",
    "Như Hoa",
    "Như Hảo",
    "Như Hồng",
    "Như Loan",
    "Như Mai",
    "Như Ngà",
    "Như Ngọc",
    "Như Phương",
    "Như Quân",
    "Như Quỳnh",
    "Như Thảo",
    "Như Trân",
    "Như Tâm",
    "Như Ý",
    "Nhất Thương",
    "Nhật Dạ",
    "Nhật Hà",
    "Nhật Hạ",
    "Nhật Lan",
    "Nhật Linh",
    "Nhật Lệ",
    "Nhật Mai",
    "Nhật Phương",
    "Nhật Ánh",
    "Oanh Thơ",
    "Oanh Vũ",
    "Phi Khanh",
    "Phi Nhung",
    "Phi Nhạn",
    "Phi Phi",
    "Phi Phượng",
    "Phong Lan",
    "Phương An",
    "Phương Anh",
    "Phương Chi",
    "Phương Châu",
    "Phương Diễm",
    "Phương Dung",
    "Phương Giang",
    "Phương Hiền",
    "Phương Hoa",
    "Phương Hạnh",
    "Phương Lan",
    "Phương Linh",
    "Phương Liên",
    "Phương Loan",
    "Phương Mai",
    "Phương Nghi",
    "Phương Ngọc",
    "Phương Nhi",
    "Phương Nhung",
    "Phương Phương",
    "Phương Quyên",
    "Phương Quân",
    "Phương Quế",
    "Phương Quỳnh",
    "Phương Thanh",
    "Phương Thi",
    "Phương Thùy",
    "Phương Thảo",
    "Phương Thủy",
    "Phương Trang",
    "Phương Trinh",
    "Phương Trà",
    "Phương Trâm",
    "Phương Tâm",
    "Phương Uyên",
    "Phương Yến",
    "Phước Bình",
    "Phước Huệ",
    "Phượng Bích",
    "Phượng Liên",
    "Phượng Loan",
    "Phượng Lệ",
    "Phượng Nga",
    "Phượng Nhi",
    "Phượng Tiên",
    "Phượng Uyên",
    "Phượng Vy",
    "Phượng Vũ",
    "Phụng Yến",
    "Quế Anh",
    "Quế Chi",
    "Quế Linh",
    "Quế Lâm",
    "Quế Phương",
    "Quế Thu",
    "Quỳnh Anh",
    "Quỳnh Chi",
    "Quỳnh Dao",
    "Quỳnh Dung",
    "Quỳnh Giang",
    "Quỳnh Giao",
    "Quỳnh Hoa",
    "Quỳnh Hà",
    "Quỳnh Hương",
    "Quỳnh Lam",
    "Quỳnh Liên",
    "Quỳnh Lâm",
    "Quỳnh Nga",
    "Quỳnh Ngân",
    "Quỳnh Nhi",
    "Quỳnh Nhung",
    "Quỳnh Như",
    "Quỳnh Phương",
    "Quỳnh Sa",
    "Quỳnh Thanh",
    "Quỳnh Thơ",
    "Quỳnh Tiên",
    "Quỳnh Trang",
    "Quỳnh Trâm",
    "Quỳnh Vân",
    "Sao Băng",
    "Sao Mai",
    "Song Kê",
    "Song Lam",
    "Song Oanh",
    "Song Thư",
    "Sông Hà",
    "Sông Hương",
    "Sơn Ca",
    "Sơn Tuyền",
    "Sương Sương",
    "Thanh Bình",
    "Thanh Dân",
    "Thanh Giang",
    "Thanh Hiếu",
    "Thanh Hiền",
    "Thanh Hoa",
    "Thanh Huyền",
    "Thanh Hà",
    "Thanh Hương",
    "Thanh Hường",
    "Thanh Hạnh",
    "Thanh Hảo",
    "Thanh Hằng",
    "Thanh Hồng",
    "Thanh Kiều",
    "Thanh Lam",
    "Thanh Lan",
    "Thanh Loan",
    "Thanh Lâm",
    "Thanh Mai",
    "Thanh Mẫn",
    "Thanh Nga",
    "Thanh Nguyên",
    "Thanh Ngân",
    "Thanh Ngọc",
    "Thanh Nhung",
    "Thanh Nhàn",
    "Thanh Nhã",
    "Thanh Phương",
    "Thanh Thanh",
    "Thanh Thiên",
    "Thanh Thu",
    "Thanh Thúy",
    "Thanh Thư",
    "Thanh Thảo",
    "Thanh Thủy",
    "Thanh Trang",
    "Thanh Trúc",
    "Thanh Tuyết",
    "Thanh Tuyền",
    "Thanh Tâm",
    "Thanh Uyên",
    "Thanh Vy",
    "Thanh Vân",
    "Thanh Xuân",
    "Thanh Yến",
    "Thanh Đan",
    "Thi Cầm",
    "Thi Ngôn",
    "Thi Thi",
    "Thi Xuân",
    "Thi Yến",
    "Thiên Di",
    "Thiên Duyên",
    "Thiên Giang",
    "Thiên Hà",
    "Thiên Hương",
    "Thiên Khánh",
    "Thiên Kim",
    "Thiên Lam",
    "Thiên Lan",
    "Thiên Mai",
    "Thiên Mỹ",
    "Thiên Nga",
    "Thiên Nương",
    "Thiên Phương",
    "Thiên Thanh",
    "Thiên Thêu",
    "Thiên Thư",
    "Thiên Thảo",
    "Thiên Trang",
    "Thiên Tuyền",
    "Thiếu Mai",
    "Thiều Ly",
    "Thiện Mỹ",
    "Thiện Tiên",
    "Thu Duyên",
    "Thu Giang",
    "Thu Hiền",
    "Thu Hoài",
    "Thu Huyền",
    "Thu Huệ",
    "Thu Hà",
    "Thu Hậu",
    "Thu Hằng",
    "Thu Hồng",
    "Thu Linh",
    "Thu Liên",
    "Thu Loan",
    "Thu Mai",
    "Thu Minh",
    "Thu Nga",
    "Thu Nguyệt",
    "Thu Ngà",
    "Thu Ngân",
    "Thu Ngọc",
    "Thu Nhiên",
    "Thu Oanh",
    "Thu Phong",
    "Thu Phương",
    "Thu Phượng",
    "Thu Sương",
    "Thu Thuận",
    "Thu Thảo",
    "Thu Thủy",
    "Thu Trang",
    "Thu Việt",
    "Thu Vân",
    "Thu Vọng",
    "Thu Yến",
    "Thuần Hậu",
    "Thy Khanh",
    "Thy Oanh",
    "Thy Trúc",
    "Thy Vân",
    "Thái Chi",
    "Thái Hà",
    "Thái Hồng",
    "Thái Lan",
    "Thái Lâm",
    "Thái Thanh",
    "Thái Thảo",
    "Thái Tâm",
    "Thái Vân",
    "Thùy Anh",
    "Thùy Dung",
    "Thùy Dương",
    "Thùy Giang",
    "Thùy Linh",
    "Thùy Mi",
    "Thùy My",
    "Thùy Nhi",
    "Thùy Như",
    "Thùy Oanh",
    "Thùy Uyên",
    "Thùy Vân",
    "Thúy Anh",
    "Thúy Diễm",
    "Thúy Hiền",
    "Thúy Huyền",
    "Thúy Hà",
    "Thúy Hương",
    "Thúy Hường",
    "Thúy Hạnh",
    "Thúy Hằng",
    "Thúy Kiều",
    "Thúy Liên",
    "Thúy Liễu",
    "Thúy Loan",
    "Thúy Mai",
    "Thúy Minh",
    "Thúy My",
    "Thúy Nga",
    "Thúy Ngà",
    "Thúy Ngân",
    "Thúy Ngọc",
    "Thúy Phượng",
    "Thúy Quỳnh",
    "Thúy Vi",
    "Thúy Vy",
    "Thúy Vân",
    "Thơ Thơ",
    "Thư Lâm",
    "Thư Sương",
    "Thương Huyền",
    "Thương Nga",
    "Thương Thương",
    "Thường Xuân",
    "Thạch Thảo",
    "Thảo Hương",
    "Thảo Hồng",
    "Thảo Linh",
    "Thảo Ly",
    "Thảo Mai",
    "Thảo My",
    "Thảo Nghi",
    "Thảo Nguyên",
    "Thảo Nhi",
    "Thảo Quyên",
    "Thảo Tiên",
    "Thảo Trang",
    "Thảo Uyên",
    "Thảo Vy",
    "Thảo Vân",
    "Thục Anh",
    "Thục Khuê",
    "Thục Nhi",
    "Thục Oanh",
    "Thục Quyên",
    "Thục Trang",
    "Thục Trinh",
    "Thục Tâm",
    "Thục Uyên",
    "Thục Vân",
    "Thục Ðoan",
    "Thục Ðào",
    "Thục Ðình",
    "Thụy Du",
    "Thụy Khanh",
    "Thụy Linh",
    "Thụy Lâm",
    "Thụy Miên",
    "Thụy Nương",
    "Thụy Trinh",
    "Thụy Trâm",
    "Thụy Uyên",
    "Thụy Vân",
    "Thụy Ðào",
    "Thủy Hằng",
    "Thủy Hồng",
    "Thủy Linh",
    "Thủy Minh",
    "Thủy Nguyệt",
    "Thủy Quỳnh",
    "Thủy Tiên",
    "Thủy Trang",
    "Thủy Tâm",
    "Tinh Tú",
    "Tiên Phương",
    "Tiểu Mi",
    "Tiểu My",
    "Tiểu Quỳnh",
    "Trang Anh",
    "Trang Linh",
    "Trang Nhã",
    "Trang Tâm",
    "Trang Ðài",
    "Triều Nguyệt",
    "Triều Thanh",
    "Triệu Mẫn",
    "Trung Anh",
    "Trà Giang",
    "Trà My",
    "Trâm Anh",
    "Trâm Oanh",
    "Trân Châu",
    "Trúc Chi",
    "Trúc Lam",
    "Trúc Lan",
    "Trúc Linh",
    "Trúc Liên",
    "Trúc Loan",
    "Trúc Ly",
    "Trúc Lâm",
    "Trúc Mai",
    "Trúc Phương",
    "Trúc Quân",
    "Trúc Quỳnh",
    "Trúc Vy",
    "Trúc Vân",
    "Trúc Ðào",
    "Trúc Đào",
    "Trầm Hương",
    "Tuyết Anh",
    "Tuyết Băng",
    "Tuyết Chi",
    "Tuyết Hoa",
    "Tuyết Hân",
    "Tuyết Hương",
    "Tuyết Hồng",
    "Tuyết Lan",
    "Tuyết Loan",
    "Tuyết Lâm",
    "Tuyết Mai",
    "Tuyết Nga",
    "Tuyết Nhi",
    "Tuyết Nhung",
    "Tuyết Oanh",
    "Tuyết Thanh",
    "Tuyết Trinh",
    "Tuyết Trầm",
    "Tuyết Tâm",
    "Tuyết Vy",
    "Tuyết Vân",
    "Tuyết Xuân",
    "Tuyền Lâm",
    "Tuệ Lâm",
    "Tuệ Mẫn",
    "Tuệ Nhi",
    "Tâm Hiền",
    "Tâm Hạnh",
    "Tâm Hằng",
    "Tâm Khanh",
    "Tâm Linh",
    "Tâm Nguyên",
    "Tâm Nguyệt",
    "Tâm Nhi",
    "Tâm Như",
    "Tâm Thanh",
    "Tâm Trang",
    "Tâm Ðoan",
    "Tâm Đan",
    "Tùng Linh",
    "Tùng Lâm",
    "Tùng Quân",
    "Tùy Anh",
    "Tùy Linh",
    "Tú Anh",
    "Tú Ly",
    "Tú Nguyệt",
    "Tú Quyên",
    "Tú Quỳnh",
    "Tú Sương",
    "Tú Trinh",
    "Tú Tâm",
    "Tú Uyên",
    "Túy Loan",
    "Tường Chinh",
    "Tường Vi",
    "Tường Vy",
    "Tường Vân",
    "Tịnh Lâm",
    "Tịnh Nhi",
    "Tịnh Như",
    "Tịnh Tâm",
    "Tịnh Yên",
    "Tố Loan",
    "Tố Nga",
    "Tố Nhi",
    "Tố Quyên",
    "Tố Tâm",
    "Tố Uyên",
    "Từ Dung",
    "Từ Ân",
    "Uyên Minh",
    "Uyên My",
    "Uyên Nhi",
    "Uyên Phương",
    "Uyên Thi",
    "Uyên Thy",
    "Uyên Thơ",
    "Uyên Trâm",
    "Uyên Vi",
    "Uyển Khanh",
    "Uyển My",
    "Uyển Nghi",
    "Uyển Nhi",
    "Uyển Nhã",
    "Uyển Như",
    "Vi Quyên",
    "Vinh Diệu",
    "Việt Hà",
    "Việt Hương",
    "Việt Khuê",
    "Việt Mi",
    "Việt Nga",
    "Việt Nhi",
    "Việt Thi",
    "Việt Trinh",
    "Việt Tuyết",
    "Việt Yến",
    "Vy Lam",
    "Vy Lan",
    "Vàng Anh",
    "Vành Khuyên",
    "Vân Anh",
    "Vân Chi",
    "Vân Du",
    "Vân Hà",
    "Vân Hương",
    "Vân Khanh",
    "Vân Khánh",
    "Vân Linh",
    "Vân Ngọc",
    "Vân Nhi",
    "Vân Phi",
    "Vân Phương",
    "Vân Quyên",
    "Vân Quỳnh",
    "Vân Thanh",
    "Vân Thúy",
    "Vân Thường",
    "Vân Tiên",
    "Vân Trang",
    "Vân Trinh",
    "Vũ Hồng",
    "Xuyến Chi",
    "Xuân Bảo",
    "Xuân Dung",
    "Xuân Hiền",
    "Xuân Hoa",
    "Xuân Hân",
    "Xuân Hương",
    "Xuân Hạnh",
    "Xuân Lan",
    "Xuân Linh",
    "Xuân Liễu",
    "Xuân Loan",
    "Xuân Lâm",
    "Xuân Mai",
    "Xuân Nghi",
    "Xuân Ngọc",
    "Xuân Nhi",
    "Xuân Nhiên",
    "Xuân Nương",
    "Xuân Phương",
    "Xuân Phượng",
    "Xuân Thanh",
    "Xuân Thu",
    "Xuân Thảo",
    "Xuân Thủy",
    "Xuân Trang",
    "Xuân Tâm",
    "Xuân Uyên",
    "Xuân Vân",
    "Xuân Yến",
    "Xuân xanh",
    "Yên Bằng",
    "Yên Mai",
    "Yên Nhi",
    "Yên Ðan",
    "Yên Đan",
    "Yến Anh",
    "Yến Hồng",
    "Yến Loan",
    "Yến Mai",
    "Yến My",
    "Yến Nhi",
    "Yến Oanh",
    "Yến Phương",
    "Yến Phượng",
    "Yến Thanh",
    "Yến Thảo",
    "Yến Trang",
    "Yến Trinh",
    "Yến Trâm",
    "Yến Ðan",
    "Ái Hồng",
    "Ái Khanh",
    "Ái Linh",
    "Ái Nhi",
    "Ái Nhân",
    "Ái Thi",
    "Ái Thy",
    "Ái Vân",
    "Ánh Dương",
    "Ánh Hoa",
    "Ánh Hồng",
    "Ánh Linh",
    "Ánh Lệ",
    "Ánh Mai",
    "Ánh Nguyệt",
    "Ánh Ngọc",
    "Ánh Thơ",
    "Ánh Trang",
    "Ánh Tuyết",
    "Ánh Xuân",
    "Ðan Khanh",
    "Ðan Quỳnh",
    "Ðan Thu",
    "Ðinh Hương",
    "Ðoan Thanh",
    "Ðoan Trang",
    "Ðài Trang",
    "Ðông Nghi",
    "Ðông Nhi",
    "Ðông Trà",
    "Ðông Tuyền",
    "Ðông Vy",
    "Ðông Ðào",
    "Ðồng Dao",
    "Ý Bình",
    "Ý Lan",
    "Ý Nhi",
    "Đan Linh",
    "Đan Quỳnh",
    "Đan Thanh",
    "Đan Thu",
    "Đan Thư",
    "Đan Tâm",
    "Đinh Hương",
    "Đoan Thanh",
    "Đoan Trang",
    "Đài Trang",
    "Đông Nghi",
    "Đông Trà",
    "Đông Tuyền",
    "Đông Vy",
    "Đơn Thuần",
    "Đức Hạnh",
    "Ấu Lăng"
]
    let OtherName = [".",",","/","%", "&","*","-","+"];
    try {
        var Name;
            if (name == " " || name == null) return "UNKNOWN";
            switch (female_name.some(a => name.includes(a))) {
                case true: {
                    if (!OtherName.includes(name)) Name = "FEMALE";
                    else Name = ['FEMALE','MALE'][Math.floor(Math.random() * 2)];
                }
            break;
                case false: {
                    if (female_name.some(a => name.split(' ')[name.split(' ').length - 1] == a)) Name = "FEMALE";
                    else if (!OtherName.includes(name) && !female_name.includes(name)) Name = "MALE";
                    else Name = ['FEMALE','MALE'][Math.floor(Math.random() * 2)];
                }
            break;
        }
    }
    catch (e) {
        return "UNKNOWN";
    }
    return Name || "UNKNOWN";
}

function formatDeltaEvent(m) {
    var { updateData,getData,hasData } = require('./shiina/Extra/Shiina-GetThread');
    var logMessageType;
    var logMessageData;
    var logMessageBody = m.messageMetadata?.adminText || "";

switch (m.class) {
    case "AdminTextMessage":
        logMessageType = getAdminTextMessageType(m);
            logMessageData = m.untypedData;
        break;
    case "ThreadName":
        logMessageType = "log:thread-name";
            logMessageData = { name: m.name };
        break;
    case "ParticipantsAddedToGroupThread":
        logMessageType = "log:subscribe";
            logMessageData = { addedParticipants: m.addedParticipants };
        break;
    case "ParticipantLeftGroupThread":
        logMessageType = "log:unsubscribe";
        logMessageData = { leftParticipantFbId: m.leftParticipantFbId };
    break;
    case "UserLocation": {
    logMessageType = "log:user-location";
    logMessageData = {
        Image: m.attachments[0].mercury.extensible_attachment.story_attachment.media.image,
        Location: m.attachments[0].mercury.extensible_attachment.story_attachment.target.location_title,
        coordinates: m.attachments[0].mercury.extensible_attachment.story_attachment.target.coordinate,
        url: m.attachments[0].mercury.extensible_attachment.story_attachment.url
    };
}
    break;
    case "ThreadImage": {
    logMessageType = "log:thread-image";
    logMessageData = {
        attachmentID: m.image_with_metadata && m.image_with_metadata.legacy_attachment_id,
        width: m.image_with_metadata && m.image_with_metadata.original_dimensions.x,
        height: m.image_with_metadata && m.image_with_metadata.original_dimensions.y,
        url: m.image_with_metadata && m.image_with_metadata.preview.uri
    };
}
    break;
    case 'ApprovalQueue': {
            if (m.action === 'REQUESTED') {
                logMessageType = "log:approval_request";
                const inviterName = m.inviterFbId;
                const requestName = m.recipientFbId;
                const approvalRequestBody = ` Yêu cầu tham gia từ ${requestName} (được mời bởi ${inviterName})`;

                logMessageData = {
                    inviterId: m.inviterFbId?.toString(),
                    requestId: m.recipientFbId?.toString(),
                    requestTimestamp: m.requestTimestamp
                };
                logMessageBody = approvalRequestBody;
            } else if (m.action === 'REMOVED') {
        logMessageType = "log:approval_remove";
        logMessageData = {
            requestId: m.recipientFbId?.toString(),
            removedTimestamp: m.messageMetadata.timestamp
        };
        logMessageBody = `Yêu cầu tham gia của ${m.recipientFbId} đã bị Quản Trị Viên từ chối.`;
    }
            break;
        }
}
switch (hasData(formatID((m.messageMetadata.threadKey.threadFbId || m.messageMetadata.threadKey.otherUserFbId).toString()))) {
    case true: {
        switch (logMessageType) {
            case "log:thread-image": {
                let x = getData(formatID((m.messageMetadata.threadKey.threadFbId || m.messageMetadata.threadKey.otherUserFbId).toString()));
                x.imageSrc = logMessageData.url;
                updateData(formatID((m.messageMetadata.threadKey.threadFbId || m.messageMetadata.threadKey.otherUserFbId).toString()),x);
            }
            break;
            case "log:approval_remove": {
               let x = getData(formatID((m.messageMetadata.threadKey.threadFbId || m.messageMetadata.threadKey.otherUserFbId).toString()));
                x.approvalQueue = x.approvalQueue.filter(
                req => req.requestID !== logMessageData.requesterID
            );
                updateData(formatID((m.messageMetadata.threadKey.threadFbId || m.messageMetadata.threadKey.otherUserFbId).toString()),x);
            break;
            }

           case "log:approval_request": {
               let x = getData(formatID((m.messageMetadata.threadKey.threadFbId || m.messageMetadata.threadKey.otherUserFbId).toString()));
               if (!x.approvalQueue) x.approvalQueue = [];
               x.approvalQueue.push({
               inviterID: logMessageData.inviterId,
               requesterID: logMessageData.requestId,
               timestamp: logMessageData.requestTimestamp
             });
               updateData(formatID((m.messageMetadata.threadKey.threadFbId || m.messageMetadata.threadKey.otherUserFbId).toString()),x);
            break;
            }
            case "log:thread-color": {
                let x = getData(formatID((m.messageMetadata.threadKey.threadFbId || m.messageMetadata.threadKey.otherUserFbId).toString()));
                x.emoji = (logMessageData.theme_emoji || x.emoji);
                x.color = (logMessageData['theme_color'] || x.color);
                x.threadTheme.id = (logMessageData.theme_id || x.threadTheme.id);
                x.threadTheme.fallback_color = (logMessageData.theme_color  || x.color);
                x.threadTheme.accessibility_label = (logMessageData.accessibility_label || x.threadTheme.accessibility_label);
                updateData(formatID((m.messageMetadata.threadKey.threadFbId || m.messageMetadata.threadKey.otherUserFbId).toString()),x);
            }
                break;
            case "log:thread-icon": {
                let x = getData(formatID((m.messageMetadata.threadKey.threadFbId || m.messageMetadata.threadKey.otherUserFbId).toString()));
                x.emoji = (logMessageData.thread_quick_reaction_emoji || logMessageData.thread_icon || x.emoji);
                updateData(formatID((m.messageMetadata.threadKey.threadFbId || m.messageMetadata.threadKey.otherUserFbId).toString()),x);
            }
                break;
            case "log:user-nickname": {
                let x = getData(formatID((m.messageMetadata.threadKey.threadFbId || m.messageMetadata.threadKey.otherUserFbId).toString()));
                x.nicknames[logMessageData.participant_id] = (logMessageData.nickname.length == 0 ? x.userInfo.find(i => i.id == String(logMessageData.participant_id)).name : logMessageData.nickname);
                updateData(formatID((m.messageMetadata.threadKey.threadFbId || m.messageMetadata.threadKey.otherUserFbId).toString()),x);
            }
                break;
            case "log:thread-admins": {
                let x = getData(formatID((m.messageMetadata.threadKey.threadFbId || m.messageMetadata.threadKey.otherUserFbId).toString()));
                switch (logMessageData.ADMIN_EVENT) {
                    case "add_admin": {
                        x.adminIDs.push({ id: logMessageData.TARGET_ID });
                    }
                        break;
                    case "remove_admin": {
                        x.adminIDs = x.adminIDs.filter(item => item.id != logMessageData.TARGET_ID);
                    }
                    break;
                }
                updateData(formatID((m.messageMetadata.threadKey.threadFbId || m.messageMetadata.threadKey.otherUserFbId).toString()),x);
            }
                break;
            case "log:thread-approval-mode": {
                let x = getData(formatID((m.messageMetadata.threadKey.threadFbId || m.messageMetadata.threadKey.otherUserFbId).toString()));
                if (x.approvalMode == true) {
                    x.approvalMode = false;
                }
                else {
                    x.approvalMode = true;
                }
                updateData(formatID((m.messageMetadata.threadKey.threadFbId || m.messageMetadata.threadKey.otherUserFbId).toString()),x);
            }
                break;
            case "log:thread-name": {
                let x = getData(formatID((m.messageMetadata.threadKey.threadFbId || m.messageMetadata.threadKey.otherUserFbId).toString()));
                x.threadName = (logMessageData.name || formatID((m.messageMetadata.threadKey.threadFbId || m.messageMetadata.threadKey.otherUserFbId).toString()));
                updateData(formatID((m.messageMetadata.threadKey.threadFbId || m.messageMetadata.threadKey.otherUserFbId).toString()),x);
            }
                break;
            case "log:subscribe": {
                let x = getData(formatID((m.messageMetadata.threadKey.threadFbId || m.messageMetadata.threadKey.otherUserFbId).toString()));
                for (let o of logMessageData.addedParticipants) {
                    if (x.userInfo.some(i => i.id == o.userFbId)) continue;
                    else {
                        x.userInfo.push({
                            id: o.userFbId,
                            name: o.fullName,
                            gender: getGenderByPhysicalMethod(o.fullName)
                        });
                        x.participantIDs.push(o.userFbId);
                    }
                }
                        if (x.approvalQueue) {
        x.approvalQueue = x.approvalQueue.filter(
            req => !logMessageData.addedParticipants.some(
                p => p.userFbId === req.requesterID
            )
        );
    }
                updateData(formatID((m.messageMetadata.threadKey.threadFbId || m.messageMetadata.threadKey.otherUserFbId).toString()),x);
            }
                break;
            case "log:unsubscribe": {
                let x = getData(formatID((m.messageMetadata.threadKey.threadFbId || m.messageMetadata.threadKey.otherUserFbId).toString()));
                x.participantIDs = x.participantIDs.filter(item => item != logMessageData.leftParticipantFbId);
                x.userInfo = x.userInfo.filter(item => item.id != logMessageData.leftParticipantFbId);
                    if (x.adminIDs.some(i => i.id == logMessageData.leftParticipantFbId)) {
                        x.adminIDs = x.adminIDs.filter(item => item.id != logMessageData.leftParticipantFbId);
                    }
                updateData(formatID((m.messageMetadata.threadKey.threadFbId || m.messageMetadata.threadKey.otherUserFbId).toString()),x);
            }
            break;
        }
    }
}

return {
    type: "event",
    threadID: formatID((m.messageMetadata.threadKey.threadFbId || m.messageMetadata.threadKey.otherUserFbId).toString()),
    logMessageType: logMessageType,
    logMessageData: logMessageData,
    logMessageBody: logMessageBody,
    author: m.messageMetadata.actorFbId,
    participantIDs: m.participants || []
    };
}

function formatTyp(event) {
return {
        isTyping: !!event.st,
        from: event.from.toString(),
        threadID: formatID((event.to || event.thread_fbid || event.from).toString()),

        fromMobile: event.hasOwnProperty("from_mobile") ? event.from_mobile : true,
        userID: (event.realtime_viewer_fbid || event.from).toString(),
        type: "typ"
    };
}

function formatDeltaReadReceipt(delta) {

    return {
        reader: (delta.threadKey.otherUserFbId || delta.actorFbId).toString(),
        time: delta.actionTimestampMs,
        threadID: formatID((delta.threadKey.otherUserFbId || delta.threadKey.threadFbId).toString()),
        type: "read_receipt"
    };
}

function formatReadReceipt(event) {
    return {
        reader: event.reader.toString(),
        time: event.time,
        threadID: formatID((event.thread_fbid || event.reader).toString()),
        type: "read_receipt"
    };
}

function formatRead(event) {
    return {
        threadID: formatID(((event.chat_ids && event.chat_ids[0]) || (event.thread_fbids && event.thread_fbids[0])).toString()),
        time: event.timestamp,
        type: "read"
    };
}

function getFrom(str, startToken, endToken) {
    var start = str.indexOf(startToken) + startToken.length;
    if (start < startToken.length) return "";

    var lastHalf = str.substring(start);
    var end = lastHalf.indexOf(endToken);
    if (end === -1) throw Error("Could not find endTime `" + endToken + "` in the given string.");
    return lastHalf.substring(0, end);
}

function makeParsable(html) {
    let withoutForLoop = html.replace(/for\s*\(\s*;\s*;\s*\)\s*;\s*/, "");

    let maybeMultipleObjects = withoutForLoop.split(/\}\r?\n *\{/);
    if (maybeMultipleObjects.length === 1) return maybeMultipleObjects;

    return "[" + maybeMultipleObjects.join("},{") + "]";
}

function arrToForm(form) {
    return arrayToObject(form,
        function(v) {
            return v.name;
        },
        function(v) {
            return v.val;
        }
    );
}

function arrayToObject(arr, getKey, getValue) {
    return arr.reduce(function(
 acc, val) {
        acc[getKey(val)] = getValue(val);
        return acc;
    }, {});
}

function getSignatureID() {
    return Math.floor(Math.random() * 2147483648).toString(16);
}

function generateTimestampRelative() {
    var d = new Date();
    return d.getHours() + ":" + padZeros(d.getMinutes());
}

function makeDefaults(html, userID, ctx) {
    var reqCounter = 1;
    var fb_dtsg = getFrom(html, 'name="fb_dtsg" value="', '"');

    var ttstamp = "2";
    for (var i = 0; i < fb_dtsg.length; i++) ttstamp += fb_dtsg.charCodeAt(i);
    var revision = getFrom(html, 'revision":', ",");

    function mergeWithDefaults(obj) {

        var newObj = {
            __user: userID,
            __req: (reqCounter++).toString(36),
            __rev: revision,
            __a: 1,

            fb_dtsg: ctx.fb_dtsg ? ctx.fb_dtsg : fb_dtsg,
            jazoest: ctx.ttstamp ? ctx.ttstamp : ttstamp

        };

        if (!obj) return newObj;
        for (var prop in obj)
            if (obj.hasOwnProperty(prop))
                if (!newObj[prop]) newObj[prop] = obj[prop];
        return newObj;
    }

    function postWithDefaults(url, jar, form, ctxx) {
        return post(url, jar, mergeWithDefaults(form), ctx.globalOptions, ctxx || ctx);
    }

    function getWithDefaults(url, jar, qs, ctxx) {
        return get(url, jar, mergeWithDefaults(qs), ctx.globalOptions, ctxx || ctx);
    }

    function postFormDataWithDefault(url, jar, form, qs, ctxx) {
        return postFormData(url, jar, mergeWithDefaults(form), mergeWithDefaults(qs), ctx.globalOptions, ctxx || ctx);
    }

    return {
        get: getWithDefaults,
        post: postWithDefaults,
        postFormData: postFormDataWithDefault
    };
}

function parseAndCheckLogin(ctx, defaultFuncs, retryCount) {
   if (retryCount == undefined) retryCount = 0;
   return function(data) {
       return bluebird.try(function() {
           log.verbose("parseAndCheckLogin", data.body);

           if (data.statusCode >= 500 && data.statusCode < 600) {
               log.verbose("Server error response:", {status: data.statusCode, body: data.body});

               if (retryCount >= 5) {
                   throw {
                       error: "Request retry failed. Check the `res` and `statusCode` property on this error.",
                       statusCode: data.statusCode,
                       res: data.body
                   };
               }
               retryCount++;
               var retryTime = Math.floor(Math.random() * 5000);
               log.warn("parseAndCheckLogin", "Got status code " + data.statusCode + " - " + retryCount + ". attempt to retry in " + retryTime + " milliseconds...");
               var url = data.request.uri.protocol + "//" + data.request.uri.hostname + data.request.uri.pathname;
               if (data.request.headers["Content-Type"].split(";")[0] === "multipart/form-data") {
                   return bluebird.delay(retryTime)
                       .then(() => defaultFuncs.postFormData(url, ctx.jar, data.request.formData, {}))
                       .then(parseAndCheckLogin(ctx, defaultFuncs, retryCount));
               } else {
                   return bluebird.delay(retryTime)
                       .then(() => defaultFuncs.post(url, ctx.jar, data.request.formData))
                       .then(parseAndCheckLogin(ctx, defaultFuncs, retryCount));
               }
           }
           if (data.statusCode !== 200) {
               log.verbose("Non-200 status code:", {status: data.statusCode, body: data.body});
               throw new Error("parseAndCheckLogin got status code: " + data.statusCode + ". Bailing out of trying to parse response.");
           }

           var res = null;
           try {
               res = JSON.parse(makeParsable(data.body));
               log.verbose("Parsed response:", res);
               if (res.jsmods && res.jsmods.require) {
                   log.verbose("JSMODS require:", res.jsmods.require);
               }
           } catch (e) {
               log.verbose("JSON parse error:", {error: e, body: data.body});
               throw {
                   error: "JSON.parse error. Check the `detail` property on this error.",
                   detail: e,
                   res: data.body
               };
           }

           if (res.redirect && data.request.method === "GET") {
               log.verbose("Redirect URL:", res.redirect);
               return defaultFuncs.get(res.redirect, ctx.jar)
                   .then(parseAndCheckLogin(ctx, defaultFuncs));
           }

           if (res.jsmods && res.jsmods.require && Array.isArray(res.jsmods.require[0]) && res.jsmods.require[0][0] === "Cookie") {
               log.verbose("Cookie update:", res.jsmods.require[0][3]);
               res.jsmods.require[0][3][0] = res.jsmods.require[0][3][0].replace("_js_", "");
               var cookie = formatCookie(res.jsmods.require[0][3], "facebook");
               var cookie2 = formatCookie(res.jsmods.require[0][3], "messenger");
               ctx.jar.setCookie(cookie, "https://www.facebook.com");
               ctx.jar.setCookie(cookie2, "https://www.messenger.com");
           }

           if (res.jsmods && Array.isArray(res.jsmods.require)) {
               var arr = res.jsmods.require;
               for (var i in arr) {
                   if (arr[i][0] === "DTSG" && arr[i][1] === "setToken") {
                       log.verbose("New DTSG token:", arr[i][3][0]);
                       ctx.fb_dtsg = arr[i][3][0];

                       ctx.ttstamp = "2";
                       for (var j = 0; j < ctx.fb_dtsg.length; j++) {
                           ctx.ttstamp += ctx.fb_dtsg.charCodeAt(j);
                       }
                       log.verbose("New ttstamp:", ctx.ttstamp);
                   }
               }
           }
           if (res.error === 1357032) {
               log.verbose("Got error 1357032 - Link blocked");
               var _bodyStr = String(data.body || "");
               if (_bodyStr.includes("1501092823525282")) {
                   global.Fca.Require.logger.Error('Tài khoản dính Checkpoint 282 - cần kiểm tra/xác minh thủ công trên trình duyệt.');
               } else if (_bodyStr.includes("828281030927956")) {
                   global.Fca.Require.logger.Error('Tài khoản dính Checkpoint 956 - cần kiểm tra/xác minh thủ công trên trình duyệt.');
               } else {
                   global.Fca.Require.logger.Error('Tài khoản đã bị khóa (lỗi 1357032), không xác định được loại checkpoint cụ thể.');
               }
               process.exit(9);
        }
           if (res.error === 1357001) {
               log.verbose("Got error 1357001");
               if (data.body.includes('checkpoint') || data.body.includes('601051028565049')) {
                    try {
                        const form = {
                            av: ctx.userID,
                            fb_api_caller_class: "RelayModern",
                            fb_api_req_friendly_name: "FBScrapingWarningMutation",
                            doc_id: "6339492849481770",
                            variables: JSON.stringify({}),
                            server_timestamps: true,
                            fb_dtsg: ctx.fb_dtsg
                        };

                        return defaultFuncs.post("https://www.facebook.com/api/graphql/", ctx.jar, form)
                            .then(function(res2) {
                                if (res2.body.includes('success')) {
                                    global.Fca.logger.Normal("Successfully bypassed checkpoint 049");
                                    global.Fca.reconnectMqtt();
                                    return defaultFuncs.get('https://www.facebook.com/', ctx.jar)
                                        .then(parseAndCheckLogin(ctx, defaultFuncs));
                                }
                                throw {error: "Failed to bypass checkpoint 049"};
                            });
                    } catch (err) {
                        global.Fca.logger.Normal("Error during checkpoint bypass:", err);
                    }
                } else {
                    log.warn("parseAndCheckLogin", "Facebook trả về mã lỗi 1357001 (Yêu cầu bị giới hạn hoặc token cũ), bỏ qua và không làm gián đoạn bot.");
                    throw { error: "Facebook API 1357001", res: res };
                }
            }

           return res;
       });
   };
}

function saveCookies(jar) {
    return function(res) {
        var cookies = res.headers["set-cookie"] || [];
        cookies.forEach(function(c) {
            if (c.indexOf(".facebook.com") > -1) {
                jar.setCookie(c, "https://www.facebook.com");
                jar.setCookie(c.replace(/domain=\.facebook\.com/, "domain=.messenger.com"), "https://www.messenger.com");
            }
        });
        return res;
    };
}

var NUM_TO_MONTH = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec"
];
var NUM_TO_DAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function formatDate(date) {
    var d = date.getUTCDate();
    d = d >= 10 ? d : "0" + d;
    var h = date.getUTCHours();
    h = h >= 10 ? h : "0" + h;
    var m = date.getUTCMinutes();
    m = m >= 10 ? m : "0" + m;
    var s = date.getUTCSeconds();
    s = s >= 10 ? s : "0" + s;
    return (NUM_TO_DAY[date.getUTCDay()] + ", " + d + " " + NUM_TO_MONTH[date.getUTCMonth()] + " " + date.getUTCFullYear() + " " + h + ":" + m + ":" + s + " GMT");
}

function formatCookie(arr, url) {
    return arr[0] + "=" + arr[1] + "; Path=" + arr[3] + "; Domain=" + url + ".com";
}

function formatThread(data) {
    return {
        threadID: formatID(data.thread_fbid.toString()),
        participants: data.participants.map(formatID),
        participantIDs: data.participants.map(formatID),
        name: data.name,
        nicknames: data.custom_nickname,
        snippet: data.snippet,
        snippetAttachments: data.snippet_attachments,
        snippetSender: formatID((data.snippet_sender || "").toString()),
        unreadCount: data.unread_count,
        messageCount: data.message_count,
        imageSrc: data.image_src,
        timestamp: data.timestamp,
        muteUntil: data.mute_until,
        isCanonicalUser: data.is_canonical_user,
        isCanonical: data.is_canonical,
        isSubscribed: data.is_subscribed,
        folder: data.folder,
        isArchived: data.is_archived,
        recipientsLoadable: data.recipients_loadable,
        hasEmailParticipant: data.has_email_participant,
        readOnly: data.read_only,
        canReply: data.can_reply,
        cannotReplyReason: data.cannot_reply_reason,
        lastMessageTimestamp: data.last_message_timestamp,
        lastReadTimestamp: data.last_read_timestamp,
        lastMessageType: data.last_message_type,
        emoji: data.custom_like_icon,
        color: data.custom_color,
        adminIDs: data.admin_ids,
        threadType: data.thread_type
    };
}

function getType(obj) {
    return Object.prototype.toString.call(obj).slice(8, -1);
}

function formatProxyPresence(presence, userID) {
    if (presence.lat === undefined || presence.p === undefined) return null;
    return {
        type: "presence",
        timestamp: presence.lat * 1000,
        userID: userID || '',
        statuses: presence.p
    };
}

function formatPresence(presence, userID) {
    return {
        type: "presence",
        timestamp: presence.la * 1000,
        userID: userID || '',
        statuses: presence.a
    };
}

function decodeClientPayload(payload) {

    function Utf8ArrayToStr(array) {
        var out, i, len, c;
        var char2, char3;
        out = "";
        len = array.length;
        i = 0;
        while (i < len) {
            c = array[i++];
            switch (c >> 4) {
                case 0:
                case 1:
                case 2:
                case 3:
                case 4:
                case 5:
                case 6:
                case 7:
                    out += String.fromCharCode(c);
                    break;
                case 12:
                case 13:
                    char2 = array[i++];
                    out += String.fromCharCode(((c & 0x1F) << 6) | (char2 & 0x3F));
                    break;
                case 14:
                    char2 = array[i++];
                    char3 = array[i++];
                    out += String.fromCharCode(((c & 0x0F) << 12) | ((char2 & 0x3F) << 6) | ((char3 & 0x3F) << 0));
                    break;
            }
        }
        return out;
    }
    return JSON.parse(Utf8ArrayToStr(payload));
}

function getAppState(jar) {
    var prettyMilliseconds = require('pretty-ms');
    var getText = globalThis.Fca.getText;
    var logger = require('./shiina/logger'), languageFile = require('./shiina/Language/index.json');
    var Language = languageFile.find(i => i.Language == globalThis.Fca.Require.FastConfig.Language).Folder.Index;
    var appstate = jar.getCookies("https://www.facebook.com").concat(jar.getCookies("https://facebook.com")).concat(jar.getCookies("https://www.messenger.com"));

    if(!globalThis.Fca.Setting.get('getAppState')) {
        logger.Normal(getText(Language.ProcessDone,`${prettyMilliseconds(Date.now() - globalThis.Fca.startTime)}`), function() {
            globalThis.Fca.Setting.set('getAppState', true);
        });
    }

    return appstate;
}

function getData_Path(Obj , Arr, Stt) {

    if (Arr.length === 0 && Obj != undefined) {
        return Obj;
    }
    else if (Obj == undefined) {
        return Stt;
    }
    const head = Arr[0];
    if (head == undefined) {
        return Stt;
    }
    const tail = Arr.slice(1);
    return getData_Path(Obj[head], tail, Stt++);
}

function setData_Path(obj, path, value) {
    if (!path.length) {
        return obj;
    }
    const currentKey = path[0];
    let currentObj = obj[currentKey];

    if (!currentObj) {
        obj[currentKey] = value;
        currentObj = obj[currentKey];
    }
    path.shift();
    if (!path.length) {
        currentObj = value;
    } else {
        currentObj = setData_Path(currentObj, path, value);
    }

    return obj;
}

function getPaths(obj, parentPath = []) {
    let paths = [];
        for (let prop in obj) {
            if (typeof obj[prop] === "object") {
                paths = paths.concat(getPaths(obj[prop], [...parentPath, prop]));
            } else {
                paths.push([...parentPath, prop]);
            }
        }
    return paths;
}

function cleanHTML (text) {
    text = text.replace(/(<br>)|(<\/?i>)|(<\/?em>)|(<\/?b>)|(!?~)|(&amp;)|(&#039;)|(&lt;)|(&gt;)|(&quot;)/g, (match) => {
        switch (match) {
          case "<br>":
            return "\n";
          case "<i>":
          case "<em>":
          case "</i>":
          case "</em>":
            return "*";
          case "<b>":
          case "</b>":
            return "**";
          case "~!":
          case "!~":
            return "||";
          case "&amp;":
            return "&";
          case "&#039;":
            return "'";
          case "&lt;":
            return "<";
          case "&gt;":
            return ">";
          case "&quot;":
            return '"';
        }
    });
    return text;
}

const LIGHTSPEED_VERSION_ID = "27712806675058809";
const LIGHTSPEED_APP_ID = "2220391788200892";

function unwrapLsVal(val) {
    if (val === undefined || val === null) return null;
    if (Array.isArray(val)) {
        if (val.length === 1 && val[0] === 9) return null; // [9] is null in AST
        if (val.length === 2 && (val[0] === 19 || val[0] === 2)) return val[1]; // [19, scalar]
        if (val.length === 0) return null;
        return unwrapLsVal(val[val.length - 1]);
    }
    return val;
}

const LIGHTSPEED_LABELS = {
    SET_TYPING_INDICATOR: "18",
    MARK_READ: "21",
    ADD_PARTICIPANTS: "23",
    SET_ADMIN_STATUS: "25",
    REACTION: "29",
    SEARCH_USER: "30",
    SET_THREAD_NAME: "32",
    UNSEND_MESSAGE: "33",
    SET_THREAD_IMAGE: "37",
    SET_THREAD_THEME: "43",
    SET_NICKNAME: "44",
    SEND_MESSAGE: "46",
    ACCEPT_MESSAGE_REQUEST: "66",
    SEND_MESSAGE_ENTRY: "130",
    REMOVE_PARTICIPANT: "140",
    REMOVE_PARTICIPANT_ALT: "722",
    MUTE_THREAD: "144",
    FETCH_THREAD_LIST: "145",
    DELETE_THREAD: "146",
    CREATE_GROUP: "153",
    DELETE_MESSAGE_ME_ONLY: "155",
    CREATE_POLL: "163",
    UPDATE_POLL: "164",
    POLL_POINT_QUERY: "170",
    PROACTIVE_WARNINGS: "192",
    GET_CONTACTS_FULL: "207",
    FETCH_THREAD_METADATA: "209",
    MESSAGE_RANGE_QUERY: "228",
    PIN_MESSAGE: "430",
    PIN_MESSAGE_SEARCH: "751",
    UNPIN_MESSAGE: "431",
    REACTION_V2: "604",
    EDIT_MESSAGE: "742",
    SET_AI_THEME: "1013",
    SET_THREAD_THEME_WRITER: "1028",
    SET_CUSTOM_THEME: "1037",
    SET_QUICK_EMOJI: "100003",
    CHECK_THREAD_CONSISTENCY: "160019"
};

function decodeLsSteps(data, refs = new Map()) {
    if (!Array.isArray(data)) return data;
    const stepType = data[0];
    const stepData = data.slice(1);
    switch (stepType) {
        case 1:
            return stepData.map(d => Array.isArray(d) ? decodeLsSteps(d, refs) : d);
        case 2:
            return refs.has(stepData[0]) ? refs.get(stepData[0]) : null;
        case 3: {
            const val = decodeLsSteps(stepData[1], refs);
            refs.set(stepData[0], val);
            return { op: 'STORE', key: stepData[0], value: val };
        }
        case 4:
            refs.set(stepData[0], stepData[1]);
            return { op: 'STORE_ARRAY', key: stepData[0], value: stepData[1] };
        case 5: {
            const refName = stepData[0];
            const args = stepData.slice(1).map(a => decodeLsSteps(a, refs));
            return { op: refName, is_call: true, args: args };
        }
        case 9: return null;
        case 16:
            try { return Buffer.from(stepData[0], 'base64').toString('utf8'); } catch(_) { return stepData[0]; }
        case 19: return String(stepData[0]);
        case 23: {
            const cond = decodeLsSteps(stepData[0], refs);
            if (cond) return decodeLsSteps(stepData[1], refs);
            if (stepData.length >= 3 && stepData[2] != null) return decodeLsSteps(stepData[2], refs);
            return null;
        }
        default: return { op: 'OP_' + stepType, raw: stepData };
    }
}

function walkLsStep(node, visitor) {
    if (!node) return;
    if (typeof visitor !== "function") return;

    let stepTree = node;
    while (typeof stepTree === "string") {
        try { stepTree = JSON.parse(stepTree); } catch (_) { break; }
    }
    if (stepTree && typeof stepTree === "object") {
        if (stepTree.step !== undefined) {
            stepTree = stepTree.step;
            while (typeof stepTree === "string") {
                try { stepTree = JSON.parse(stepTree); } catch (_) { break; }
            }
        } else if (stepTree.payload !== undefined) {
            let p = stepTree.payload;
            while (typeof p === "string") {
                try { p = JSON.parse(p); } catch (_) { break; }
            }
            if (p && p.step !== undefined) {
                stepTree = p.step;
                while (typeof stepTree === "string") {
                    try { stepTree = JSON.parse(stepTree); } catch (_) { break; }
                }
            }
        }
    }

    function walk(n) {
        if (!n || typeof n !== "object") return;
        if (Array.isArray(n)) {
            if (n[0] === 5 && typeof n[1] === "string") {
                visitor(n[1], n.slice(2), n);
            }
            for (let i = 0; i < n.length; i++) {
                walk(n[i]);
            }
        } else {
            for (const key of Object.keys(n)) {
                walk(n[key]);
            }
        }
    }

    walk(stepTree);
}

function buildLsPayload(tasks, options) {
    options = options || {};
    if (!Array.isArray(tasks)) tasks = [tasks];
    const epochID = options.epoch_id || (BigInt(Date.now()) << 22n).toString();
    const versionID = options.version_id || LIGHTSPEED_VERSION_ID;
    const dataTraceID = options.data_trace_id || ("#" + Buffer.from(String(Math.random())).toString("base64").replace(/=+$/, ""));

    const mappedTasks = tasks.map((t, idx) => ({
        failure_count: t.failure_count != null ? t.failure_count : null,
        label: String(t.label != null ? t.label : (t.labelId || "46")),
        payload: typeof t.payload === "string" ? t.payload : JSON.stringify(t.payload || {}),
        queue_name: String(t.queue_name || t.queueName || ""),
        task_id: Number(t.task_id != null ? t.task_id : (t.taskId != null ? t.taskId : (idx + 1)))
    }));

    const payloadObj = {
        epoch_id: String(epochID),
        tasks: mappedTasks,
        version_id: versionID
    };
    if (options.data_trace_id) {
        payloadObj.data_trace_id = options.data_trace_id;
    }

    const innerJson = JSON.stringify(payloadObj).replace(/"epoch_id":"(\d+)"/, '"epoch_id":$1');

    return {
        app_id: options.app_id || LIGHTSPEED_APP_ID,
        payload: innerJson,
        request_id: Number(options.request_id || (global.FcaReqID = (global.FcaReqID || 0) + 1)),
        type: Number(options.type || 3)
    };
}

function waitForLsResponse(ctx, content, options) {
    options = options || {};
    var timeoutMs = options.timeoutMs || 15000;
    var responseTopic = options.responseTopic || "/ls_resp";
    var extract = options.extract;

    return new Promise(function(resolve, reject) {
        var hasGateway = ctx.gatewayClient && ctx.gatewayClient.connected;
        var hasMqtt = ctx.mqttClient && ctx.mqttClient.connected;

        if (!hasGateway && !hasMqtt) {
            return reject({ error: "Neither Lightspeed Gateway nor MQTT client is connected" });
        }

        var settled = false;
        var timer;

        function cleanup() {
            clearTimeout(timer);
            if (ctx.mqttClient && typeof ctx.mqttClient.removeListener === "function") {
                ctx.mqttClient.removeListener("message", handleRes);
            }
            if (ctx.gatewayClient && typeof ctx.gatewayClient.removeListener === "function") {
                ctx.gatewayClient.removeListener("data", handleGatewayData);
            }
        }

        function settle(fn) {
            if (settled) return;
            settled = true;
            cleanup();
            fn();
        }

        function checkExtracted(jsonMsg) {
            var matchRequestId = Boolean(content && content.request_id && String(jsonMsg.request_id) === String(content.request_id));
            var extractedResult = null;
            if (extract) {
                try {
                    extractedResult = extract(jsonMsg);
                } catch (_) { }
            }
            if (!matchRequestId && !extractedResult) return;
            settle(function() {
                try {
                    resolve(extractedResult !== null && extractedResult !== undefined ? extractedResult : (extract ? extract(jsonMsg) : jsonMsg));
                } catch (e) {
                    reject(e);
                }
            });
        }

        function handleGatewayData({ json }) {
            if (!json) return;
            checkExtracted(json);
        }

        function handleRes(topic, message) {
            if (topic !== responseTopic) return;
            var jsonMsg;
            try {
                jsonMsg = JSON.parse(message.toString());
                if (typeof jsonMsg.payload === "string") {
                    jsonMsg.payload = JSON.parse(jsonMsg.payload);
                }
            } catch (e) {
                return;
            }
            checkExtracted(jsonMsg);
        }

        // Ưu tiên Gateway DGW thuần Lightspeed
        if (hasGateway) {
            if (typeof ctx.gatewayClient.setMaxListeners === "function") {
                ctx.gatewayClient.setMaxListeners(0);
            }
            ctx.gatewayClient.on("data", handleGatewayData);

            let tasks = [];
            try {
                const parsed = typeof content === "string" ? JSON.parse(content) : content;
                const inner = typeof parsed.payload === "string" ? JSON.parse(parsed.payload) : (parsed.payload || {});
                tasks = inner.tasks || [];
            } catch (_) {}

            ctx.gatewayClient.publishTasks(tasks, {
                request_id: content.request_id,
                noWaitAck: options.noWaitAck
            }).then(() => {
                if (!extract) {
                    settle(function() { resolve({ success: true, method: "gateway" }); });
                }
            }).catch((err) => {
                if (hasMqtt) {
                    sendMqttFallback();
                } else {
                    settle(function() { reject(err); });
                }
            });
        } else {
            sendMqttFallback();
        }

        function sendMqttFallback() {
            if (!ctx.mqttClient || !ctx.mqttClient.connected) {
                return settle(function() { reject({ error: "MQTT is not connected" }); });
            }
            if (typeof ctx.mqttClient.setMaxListeners === "function") {
                ctx.mqttClient.setMaxListeners(0);
            }
            ctx.mqttClient.on("message", handleRes);
            var reqPayload = typeof content === "string" ? content : JSON.stringify(content);
            ctx.mqttClient.publish("/ls_req", reqPayload, { qos: 1, retain: false }, function(err) {
                if (err) {
                    settle(function() { reject(err); });
                } else if (!extract) {
                    settle(function() { resolve({ success: true, method: "mqtt" }); });
                }
            });
        }

        timer = setTimeout(function() {
            settle(function() { reject({ error: "Timeout waiting for ACK from Meta" }); });
        }, timeoutMs);
    });
}

function sendLsTasks(ctx, tasks, options) {
    options = options || {};
    if (ctx.gatewayClient && ctx.gatewayClient.connected) {
        return ctx.gatewayClient.publishTasks(tasks, options);
    }
    if (!ctx.mqttClient || !ctx.mqttClient.connected) {
        return Promise.reject({ error: "Neither MQTT nor Gateway client is connected" });
    }
    ctx.req_ID = (ctx.req_ID || 0) + 1;
    options.request_id = ctx.req_ID;
    const content = buildLsPayload(tasks, options);
    return waitForLsResponse(ctx, content, options);
}

function sendLsTask(ctx, task, options) {
    return sendLsTasks(ctx, [task], options);
}

module.exports = {
    cleanHTML,
    isReadableStream:isReadableStream,
    get:get,
    post:post,
    postFormData:postFormData,
    generateThreadingID:generateThreadingID,
    generateOfflineThreadingID:generateOfflineThreadingID,
    getGUID:getGUID,
    getFrom:getFrom,
    makeParsable:makeParsable,
    arrToForm:arrToForm,
    getSignatureID:getSignatureID,
    getJar: request.jar,
    generateTimestampRelative:generateTimestampRelative,
    makeDefaults:makeDefaults,
    parseAndCheckLogin:parseAndCheckLogin,
    getGender: getGenderByPhysicalMethod,
    getData_Path,
    setData_Path,
    getPaths,
    saveCookies,
    getType,
    _formatAttachment,
    formatHistoryMessage,
    formatID,
    formatMessage,
    formatDeltaEvent,
    formatDeltaMessage,
    formatProxyPresence,
    formatPresence,
    formatTyp,
    formatDeltaReadReceipt,
    formatCookie,
    formatThread,
    formatReadReceipt,
    formatRead,
    generatePresence,
    generateAccessiblityCookie,
    formatDate,
    decodeClientPayload,
    getAppState,
    getAdminTextMessageType,
    setProxy,
    waitForLsResponse,
    DEFAULT_UA,
    getHeaders,
    LIGHTSPEED_VERSION_ID,
    LIGHTSPEED_APP_ID,
    LIGHTSPEED_LABELS,
    unwrapLsVal,
    walkLsStep,
    buildLsPayload,
    sendLsTasks,
    sendLsTask
};
