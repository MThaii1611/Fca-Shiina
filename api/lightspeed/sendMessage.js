"use strict";
api: "api.sendMessage";

const { buildTask, sendTask, isConnected, LS_LABELS } = require("../../shiina/lightspeed/ls-tasks");

function genOTID() {
    return ((BigInt(Date.now()) << 22n) | BigInt(Math.floor(Math.random() * 0x3fffff))).toString();
}

function hasLinks(s) {
    return (
        typeof s === "string" &&
        /(https?:\/\/|www\.|t\.me\/|fb\.me\/|youtu\.be\/|facebook\.com\/|youtube\.com\/)/i.test(s)
    );
}

const EFFECTS = {
    LOVE:        1,
    GIFTWRAP:    2,
    CELEBRATION: 3,
    FIRE:        4
};

function normalizeEffect(eff) {
    if (eff == null) return null;
    let name = null;
    let id = null;

    if (typeof eff === "string") {
        name = eff.toUpperCase();
        id = EFFECTS[name] || (Number.isFinite(+eff) ? +eff : null);
    } else if (typeof eff === "number") {
        id = eff | 0;
    } else if (typeof eff === "object") {
        const n = eff.name || eff.style || eff.type;
        if (n) name = String(n).toUpperCase();
        if (eff.id != null) id = Number(eff.id);
        if (!id && name && EFFECTS[name]) id = EFFECTS[name];
    }

    if (!name) {
        name = Object.keys(EFFECTS).find((k) => EFFECTS[k] === id) || null;
    }
    if (!id && name && EFFECTS[name]) id = EFFECTS[name];
    return id ? { id, name } : null;
}

function getEffectMetadata(effectObj) {
    if (!effectObj) return null;
    return {
        power_up_style: effectObj.id,
        metadata_dataclass: JSON.stringify({
            media_accessibility_metadata: { alt_text: null },
            power_up: { power_up_style: effectObj.name }
        })
    };
}

module.exports = function(ctx, http, api) {
    return function sendMessage(msg, threadID, callback, replyToMessage, isGroup) {
        // Hỗ trợ trường hợp gọi: api.sendMessage(msg, threadID, replyToMessage) (dạng Promise hoặc callback bị thế chỗ)
        if (!replyToMessage && (typeof callback === "string" || typeof callback === "number")) {
            replyToMessage = callback;
            callback = undefined;
        }

        // Hỗ trợ trường hợp gọi: api.sendMessage(msg, threadID, replyToMessage, callback)
        if (typeof replyToMessage === "function" && !callback) {
            callback = replyToMessage;
            replyToMessage = undefined;
        }

        if (!callback) {
            return new Promise((resolve, reject) => {
                sendMessage(msg, threadID, (err, r) => err ? reject(err) : resolve(r), replyToMessage, isGroup);
            });
        }

        if (!isConnected(ctx)) {
            return callback(new Error("sendMessage: Chưa kết nối Lightspeed"));
        }

        if (msg && msg.attachment && typeof api.sendMqttMessage === "function") {
            return api.sendMqttMessage(msg, threadID, replyToMessage, callback);
        }

        const otid = genOTID();
        const body = typeof msg === "string" ? msg : (msg && msg.body != null ? String(msg.body) : "");
        const targetThreadID = Array.isArray(threadID) ? threadID[0] : threadID;

        const hasAttachmentInfo = Array.isArray(msg && msg.attachmentInfo) && msg.attachmentInfo.length > 0;
        const attachmentFbids = hasAttachmentInfo
            ? msg.attachmentInfo.map(f => f.image_id || f.video_id || f.audio_id || f.media_id || f.file_id || f.fbid).filter(Boolean)
            : [];
        const hasAtt = attachmentFbids.length > 0;

        const payload = {
            thread_id:            String(targetThreadID),
            otid:                 otid,
            source:               65556,
            send_type:            hasAtt ? 3 : ((msg && msg.sticker) ? 2 : 1),
            sync_group:           1,
            mark_thread_read:     1,
            text:                 (hasAtt && !body) ? null : ((msg && msg.sticker && !body) ? null : (body === "" ? null : body)),
            initiating_source:    1,
            skip_url_preview_gen: 0,
            text_has_links:       hasLinks(body) ? 1 : 0,
            multitab_env:         0
        };

        if (hasAtt) {
            payload.attachment_fbids = attachmentFbids.map(Number);
            if (!payload.metadata_dataclass) {
                payload.metadata_dataclass = JSON.stringify({ media_accessibility_metadata: { alt_text: null } });
            }
        }

        if (msg && typeof msg === "object" && msg.effect) {
            const effectObj = normalizeEffect(msg.effect);
            if (effectObj) {
                const effectMeta = getEffectMetadata(effectObj);
                if (effectMeta) {
                    payload.power_up_style = effectMeta.power_up_style;
                    payload.metadata_dataclass = effectMeta.metadata_dataclass;
                }
            }
        }

        if (msg && msg.sticker) {
            payload.sticker_id = Number(msg.sticker) || String(msg.sticker);
        }

        if (msg && msg.mentions && Array.isArray(msg.mentions)) {
            payload.mention_data = {
                mention_ids:     msg.mentions.map(m => String(m.id)),
                mention_offsets: msg.mentions.map(m => Number(m.fromIndex || 0)),
                mention_lengths: msg.mentions.map(m => Number(m.length || 0)),
                mention_types:   msg.mentions.map(() => "P")
            };
        }

        if (replyToMessage) {
            payload.reply_metadata = {
                reply_source_id:            String(replyToMessage),
                reply_source_type:          1,
                reply_type:                 0,
                reply_source_attachment_id: null
            };
        }

        const task = buildTask(LS_LABELS.SEND_MESSAGE, payload, String(targetThreadID), 1);
        sendTask(ctx, task)
            .then((res) => {
                const result = {
                    body: body || null,
                    messageID: otid,
                    otid: otid,
                    threadID: String(targetThreadID),
                    timestamp: Date.now(),
                    ...res
                };
                callback(null, result);
            })
            .catch((err) => callback(err));
    };
};
