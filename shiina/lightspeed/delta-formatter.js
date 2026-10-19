"use strict";
/**
 * shiina/lightspeed/delta-formatter.js
 * Định dạng delta và attachment tin nhắn chuẩn theo fca-shiina-lightspeed
 * Dùng cho các message nhận qua /t_ms và ClientPayload
 */

function formatID(id) {
    if (id !== undefined && id !== null) {
        return String(id).replace(/(fb)?id[:.]/, "");
    }
    return id;
}

function _formatAttachment(attachment1, attachment2) {
    attachment2 = attachment2 || { id: "", image_data: {} };
    attachment1 = attachment1 && attachment1.mercury ? attachment1.mercury : (attachment1 || {});
    let blob = attachment1.blob_attachment;
    let type = blob && blob.__typename ? blob.__typename : attachment1.attach_type;

    if (!type && attachment1.sticker_attachment) {
        type = "StickerAttachment";
        blob = attachment1.sticker_attachment;
    } else if (!type && attachment1.extensible_attachment) {
        if (
            attachment1.extensible_attachment.story_attachment &&
            attachment1.extensible_attachment.story_attachment.target &&
            attachment1.extensible_attachment.story_attachment.target.__typename &&
            attachment1.extensible_attachment.story_attachment.target.__typename === "MessageLocation"
        ) {
            type = "MessageLocation";
        } else {
            type = "ExtensibleAttachment";
        }
        blob = attachment1.extensible_attachment;
    }

    switch (type) {
        case "sticker":
        case "StickerAttachment":
            return {
                type: "sticker",
                ID: String(attachment1.metadata?.stickerID || blob?.id || ""),
                url: attachment1.url || blob?.url || "",
                packID: String(attachment1.metadata?.packID || ""),
                width: attachment1.metadata?.width || 0,
                height: attachment1.metadata?.height || 0,
                caption: attachment2.caption || ""
            };
        case "file":
        case "MessageFile":
            return {
                type: "file",
                filename: attachment1.name || blob?.filename || "",
                ID: String(attachment2.id || blob?.message_file_fbid || ""),
                url: attachment1.url || blob?.url || "",
                isMalicious: blob?.is_malicious || false,
                contentType: attachment2.mime_type || blob?.content_type || "",
                name: attachment1.name || blob?.filename || "",
                mimeType: attachment2.mime_type || blob?.content_type || "",
                fileSize: attachment2.file_size || -1
            };
        case "photo":
        case "MessageImage":
            return {
                type: "photo",
                ID: String(attachment1.metadata?.fbid || blob?.legacy_attachment_id || ""),
                filename: attachment1.fileName || blob?.filename || "",
                thumbnailUrl: attachment1.thumbnail_url || "",
                previewUrl: attachment1.preview_url || blob?.preview?.uri || "",
                url: attachment1.metadata?.url || blob?.preview?.uri || "",
                width: attachment1.metadata?.dimensions?.split(",")[0] || blob?.original_dimensions?.x || 0,
                height: attachment1.metadata?.dimensions?.split(",")[1] || blob?.original_dimensions?.y || 0,
                name: attachment1.fileName || blob?.filename || ""
            };
        case "animated_image":
        case "MessageAnimatedImage":
            return {
                type: "animated_image",
                ID: String(attachment2.id || blob?.legacy_attachment_id || ""),
                filename: attachment2.filename || "",
                previewUrl: attachment1.preview_url || blob?.preview_image?.uri || "",
                url: attachment2.image_data?.url || blob?.animated_image?.uri || "",
                width: attachment2.image_data?.width || blob?.animated_image?.width || 0,
                height: attachment2.image_data?.height || blob?.animated_image?.height || 0,
                name: attachment1.name || ""
            };
        case "share":
        case "ExtensibleAttachment":
            const story = blob?.story_attachment || attachment1.share;
            return {
                type: "share",
                ID: String(attachment1.share?.share_id || blob?.legacy_attachment_id || ""),
                url: attachment2.href || story?.url || "",
                title: story?.title || story?.title_with_entities?.text || "",
                description: story?.description?.text || "",
                source: story?.source || null,
                image: story?.media?.image?.uri || story?.media?.image || "",
                playable: story?.media?.is_playable || false,
                playableUrl: story?.media?.playable_url || null
            };
        case "video":
        case "MessageVideo":
            return {
                type: "video",
                ID: String(attachment1.metadata?.fbid || blob?.legacy_attachment_id || ""),
                filename: attachment1.name || blob?.filename || "",
                url: blob?.playable_url || attachment1.url || "",
                previewUrl: blob?.large_preview?.uri || attachment1.preview_url || "",
                duration: blob?.playable_duration_in_ms || 0,
                width: blob?.original_dimensions?.x || 0,
                height: blob?.original_dimensions?.y || 0
            };
        case "audio":
        case "MessageAudio":
            return {
                type: "audio",
                ID: String(attachment1.metadata?.fbid || blob?.legacy_attachment_id || ""),
                filename: attachment1.name || blob?.filename || "",
                url: blob?.playable_url || attachment1.url || "",
                duration: blob?.playable_duration_in_ms || 0,
                isVoiceMail: blob?.is_voicemail || false
            };
        default:
            return {
                type: "unknown",
                ID: String(attachment2.id || attachment1.id || ""),
                url: attachment1.url || ""
            };
    }
}

function formatDeltaMessage(m) {
    const md = m.messageMetadata || {};
    const body = m.body || "";
    const mdata = m.data?.prng ? JSON.parse(m.data.prng) : [];
    const mentions = {};

    if (Array.isArray(mdata) && mdata.length > 0) {
        for (let i = 0; i < mdata.length; i++) {
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
        } catch (_) {}
    }

    const attachments = (m.attachments || []).map((v) => _formatAttachment(v));
    let finalBody = body;
    if (!finalBody && attachments.length > 0 && attachments[0].url) {
        finalBody = attachments[0].url;
    }

    const args = finalBody === "" ? [] : finalBody.trim().split(/\s+/);
    const actorFbId = md.actorFbId ? md.actorFbId.toString() : "";
    const threadFbId = md.threadKey ? (md.threadKey.threadFbId || md.threadKey.otherUserFbId) : "";

    return {
        type: "message",
        senderID: formatID(actorFbId),
        threadID: formatID(threadFbId ? threadFbId.toString() : ""),
        messageID: md.messageId || "",
        args: args,
        body: finalBody,
        attachments: attachments,
        mentions: mentions,
        timestamp: parseInt(md.timestamp || Date.now()),
        isGroup: !!(md.threadKey && md.threadKey.threadFbId),
        participantIDs: m.participants ? m.participants.map(String) : []
    };
}

function decodeClientPayload(payload) {
    function Utf8ArrayToStr(array) {
        let out = "";
        const len = array.length;
        let i = 0;
        while (i < len) {
            const c = array[i++];
            switch (c >> 4) {
                case 0: case 1: case 2: case 3: case 4: case 5: case 6: case 7:
                    out += String.fromCharCode(c);
                    break;
                case 12: case 13:
                    const char2 = array[i++];
                    out += String.fromCharCode(((c & 0x1F) << 6) | (char2 & 0x3F));
                    break;
                case 14:
                    const ch2 = array[i++];
                    const ch3 = array[i++];
                    out += String.fromCharCode(((c & 0x0F) << 12) | ((ch2 & 0x3F) << 6) | ((ch3 & 0x3F) << 0));
                    break;
            }
        }
        return out;
    }
    try {
        return JSON.parse(Utf8ArrayToStr(payload));
    } catch (_) {
        return null;
    }
}

function getAdminTextMessageType(m) {
    switch (m.type) {
        case "joinable_group_link_mode_change": return "log:link-status";
        case "magic_words":                     return "log:magic-words";
        case "change_thread_theme":             return "log:thread-color";
        case "change_thread_icon":
        case "change_thread_quick_reaction":    return "log:thread-icon";
        case "change_thread_nickname":          return "log:user-nickname";
        case "change_thread_admins":            return "log:thread-admins";
        case "group_poll":                      return "log:thread-poll";
        case "change_thread_approval_mode":     return "log:thread-approval-mode";
        case "messenger_call_log":
        case "participant_joined_group_call":   return "log:thread-call";
        case "pin_messages_v2":                 return "log:thread-pinned";
        default:                                return "log:admin-text";
    }
}

function formatDeltaEvent(m) {
    let logMessageType;
    let logMessageData;

    switch (m.class) {
        case "AdminTextMessage":
            logMessageType = getAdminTextMessageType(m);
            logMessageData = m.untypedData || {};
            break;
        case "ThreadName":
            logMessageType = "log:thread-name";
            logMessageData = { name: m.name || "" };
            break;
        case "ParticipantsAddedToGroupThread":
            logMessageType = "log:subscribe";
            logMessageData = { addedParticipants: m.addedParticipants || [] };
            break;
        case "ParticipantLeftGroupThread":
            logMessageType = "log:unsubscribe";
            logMessageData = { leftParticipantFbId: m.leftParticipantFbId ? String(m.leftParticipantFbId) : "" };
            break;
        default:
            logMessageType = "log:unknown";
            logMessageData = m.untypedData || {};
    }

    const threadKey = m.messageMetadata?.threadKey || {};
    const tid = threadKey.threadFbId || threadKey.otherUserFbId || m.threadID || "";

    return {
        type: "event",
        threadID: formatID(String(tid)),
        logMessageType,
        logMessageData,
        logMessageBody: m.messageMetadata?.adminText || "",
        author: formatID(String(m.messageMetadata?.actorFbId || m.actorFbId || "")),
        timestamp: m.messageMetadata?.timestamp || Date.now()
    };
}

function formatDeltaReadReceipt(delta) {
    const threadKey = delta.threadKey || {};
    return {
        reader: String(threadKey.otherUserFbId || delta.actorFbId || ""),
        time: delta.actionTimestampMs || Date.now(),
        threadID: formatID(String(threadKey.otherUserFbId || threadKey.threadFbId || "")),
        type: "read_receipt"
    };
}

module.exports = {
    formatID,
    _formatAttachment,
    formatDeltaMessage,
    decodeClientPayload,
    getAdminTextMessageType,
    formatDeltaEvent,
    formatDeltaReadReceipt
};
