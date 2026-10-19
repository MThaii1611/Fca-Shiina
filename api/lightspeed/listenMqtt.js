"use strict";
api: "api.listenMqtt";

const EventEmitter = require("events");
const { connectMqtt } = require("../../shiina/lightspeed/ls-mqtt");
const { DgwGatewayClient } = require("../../shiina/Dgw/gateway-client");
const { walkLsStep, unwrapLsVal } = require("../../shiina/lightspeed/ls-walker");
const {
    formatID,
    _formatAttachment,
    formatDeltaMessage,
    decodeClientPayload,
    formatDeltaEvent,
    formatDeltaReadReceipt
} = require("../../shiina/lightspeed/delta-formatter");
const { saveUser, hasUser, saveThread, hasThread } = require("../../shiina/database");
const logger = require("../../shiina/logger");
const lang = require("../../shiina/Languages/vi.json");

const seenMessageCache = new Map();
function isDuplicateEvent(eventData) {
    if (!eventData) return false;
    const now = Date.now();
    let key = null;
    if (eventData.type === "message" || eventData.type === "message_reply") {
        if (!eventData.messageID) return false;
        const hasContent = Boolean((eventData.body && eventData.body.trim()) || (eventData.attachments && eventData.attachments.length > 0));
        if (!hasContent) return false;
        key = `msg_${eventData.threadID}_${eventData.messageID}`;
    } else if (eventData.type === "message_reaction") {
        key = `react_${eventData.threadID}_${eventData.messageID}_${eventData.userID}_${eventData.reaction}`;
    } else if (eventData.type === "message_unsend") {
        key = `unsend_${eventData.messageID}`;
    } else if (eventData.type === "read_receipt") {
        key = `read_${eventData.threadID}_${eventData.time}`;
    } else if (eventData.type === "typ") {
        key = `typ_${eventData.threadID}_${eventData.from}_${eventData.isTyping}`;
    } else if (eventData.type === "event" && eventData.logMessageType) {
        key = `evt_${eventData.threadID}_${eventData.logMessageType}_${JSON.stringify(eventData.logMessageData || {})}`;
    }

    if (key) {
        if (seenMessageCache.has(key)) return true;
        seenMessageCache.set(key, now);
        if (seenMessageCache.size > 800) {
            for (const [k, ts] of seenMessageCache) {
                if (now - ts > 30000) seenMessageCache.delete(k);
            }
            if (seenMessageCache.size > 1000) seenMessageCache.clear();
        }
    }
    return false;
}

function getText(key, ...args) {
    let s = lang[key] || key;
    for (let i = 0; i < args.length; i++) s = s.replace(`%${i + 1}`, args[i]);
    return s;
}

function recordDatabaseInfo(senderID, senderName, threadID, threadName, isGroup) {
    if (senderID && senderID !== "0" && !hasUser(senderID)) {
        const isNew = saveUser(senderID, senderName || "Facebook User", {});
        if (isNew) logger.Normal(getText("NEW_USER", senderName || "Facebook User", senderID));
    }
    if (threadID && threadID !== "0" && !hasThread(threadID)) {
        const isNew = saveThread(threadID, threadName || threadID, isGroup, {});
        if (isNew) {
            if (isGroup) logger.Normal(getText("NEW_GROUP", threadName || threadID, threadID));
            else logger.Normal(getText("NEW_USER", senderName || "Facebook User", threadID));
        }
    }
}

function parseDelta(ctx, delta, globalCallback) {
    if (!delta || typeof delta !== "object") return;

    if (delta.class === "NewMessage") {
        let fmtMsg;
        try {
            fmtMsg = formatDeltaMessage(delta);
        } catch (_) {
            return;
        }

        if (fmtMsg) {
            if (isDuplicateEvent(fmtMsg)) return;
            if (!ctx.options?.selfListen && fmtMsg.senderID === ctx.userID) return;

            recordDatabaseInfo(fmtMsg.senderID, null, fmtMsg.threadID, null, fmtMsg.isGroup);
            globalCallback(null, fmtMsg);
        }
        return;
    }

    if (delta.class === "ClientPayload") {
        const clientPayload = decodeClientPayload(delta.payload);
        if (clientPayload && clientPayload.deltas) {
            for (const cDelta of clientPayload.deltas) {
                if (cDelta.deltaMessageReaction) {
                    const r = cDelta.deltaMessageReaction;
                    const threadID = formatID(String(r.threadKey?.threadFbId || r.threadKey?.otherUserFbId || ""));
                    const reactionMsg = {
                        type: "message_reaction",
                        threadID: threadID,
                        messageID: r.messageId,
                        reaction: r.reaction,
                        senderID: formatID(String(r.senderId || "")),
                        userID: formatID(String(r.userId || ""))
                    };
                    globalCallback(null, reactionMsg);
                } else if (cDelta.deltaRecallMessageData) {
                    const u = cDelta.deltaRecallMessageData;
                    const threadID = formatID(String(u.threadKey?.threadFbId || u.threadKey?.otherUserFbId || ""));
                    const unsendMsg = {
                        type: "message_unsend",
                        threadID: threadID,
                        messageID: u.messageID,
                        senderID: formatID(String(u.senderID || "")),
                        deletionTimestamp: u.deletionTimestamp,
                        timestamp: u.timestamp
                    };
                    globalCallback(null, unsendMsg);
                } else if (cDelta.deltaMessageReply) {
                    const reply = cDelta.deltaMessageReply;
                    const msg = reply.message || {};
                    const md = msg.messageMetadata || {};
                    const threadID = formatID(String(md.threadKey?.threadFbId || md.threadKey?.otherUserFbId || ""));
                    const senderID = formatID(String(md.actorFbId || ""));
                    const body = msg.body || "";

                    const callbackToReturn = {
                        type: "message_reply",
                        threadID: threadID,
                        messageID: md.messageId,
                        senderID: senderID,
                        attachments: (msg.attachments || []).map((att) => {
                            try {
                                const mercury = JSON.parse(att.mercuryJSON);
                                return Object.assign(att, mercury);
                            } catch (_) { return att; }
                        }).map((att) => _formatAttachment(att)),
                        args: body.trim().split(/\s+/),
                        body: body,
                        isGroup: !!md.threadKey?.threadFbId,
                        mentions: {},
                        timestamp: parseInt(md.timestamp || Date.now()),
                        participantIDs: (msg.participants || []).map(String)
                    };

                    if (reply.repliedToMessage) {
                        const rMsg = reply.repliedToMessage;
                        const rMd = rMsg.messageMetadata || {};
                        callbackToReturn.messageReply = {
                            threadID: formatID(String(rMd.threadKey?.threadFbId || rMd.threadKey?.otherUserFbId || "")),
                            messageID: rMd.messageId,
                            senderID: formatID(String(rMd.actorFbId || "")),
                            attachments: (rMsg.attachments || []).map((att) => {
                                try {
                                    const mercury = JSON.parse(att.mercuryJSON);
                                    return Object.assign(att, mercury);
                                } catch (_) { return att; }
                            }).map((att) => _formatAttachment(att)),
                            args: (rMsg.body || "").trim().split(/\s+/),
                            body: rMsg.body || "",
                            isGroup: !!rMd.threadKey?.threadFbId,
                            mentions: {},
                            timestamp: parseInt(rMd.timestamp || Date.now()),
                            participantIDs: (rMsg.participants || []).map(String)
                        };
                    }

                    if (!ctx.options?.selfListen && callbackToReturn.senderID === ctx.userID) return;
                    recordDatabaseInfo(callbackToReturn.senderID, null, callbackToReturn.threadID, null, callbackToReturn.isGroup);
                    globalCallback(null, callbackToReturn);
                }
            }
        }
        return;
    }

    switch (delta.class) {
        case "ReadReceipt": {
            try {
                const r = formatDeltaReadReceipt(delta);
                globalCallback(null, r);
            } catch (_) {}
            break;
        }
        case "AdminTextMessage":
        case "ThreadName":
        case "ParticipantsAddedToGroupThread":
        case "ParticipantLeftGroupThread": {
            try {
                const evt = formatDeltaEvent(delta);
                if (!ctx.options?.selfListen && evt.author === ctx.userID) return;
                globalCallback(null, evt);
            } catch (_) {}
            break;
        }
    }
}

function extractAttachmentsFromStep(step, targetMid) {
    const attachments = [];
    if (!step) return attachments;

    // Fast-path: Nếu payload không chứa procedure attachment nào thì bỏ qua duyệt AST tốn CPU
    try {
        const str = typeof step === "string" ? step : (typeof step === "object" ? JSON.stringify(step) : "");
        if (str && !str.includes("Attachment")) return attachments;
    } catch (_) {}

    walkLsStep(step, (procName, args) => {
        if (!args || !Array.isArray(args)) return;

        if (procName === "insertXmaAttachment") {
            const mid = unwrapLsVal(args[28]) || unwrapLsVal(args[30]);
            if (!targetMid || mid === targetMid || String(mid).includes(String(targetMid))) {
                const title = unwrapLsVal(args[53]) || unwrapLsVal(args[54]) || unwrapLsVal(args[44]);
                const previewUrl = unwrapLsVal(args[7]) || unwrapLsVal(args[8]) || unwrapLsVal(args[49]) || unwrapLsVal(args[60]);
                const playableUrl = unwrapLsVal(args[3]) || unwrapLsVal(args[4]) || unwrapLsVal(args[117]);
                const actionUrl = unwrapLsVal(args[52]);
                attachments.push({
                    type: "share",
                    title: title ? String(title) : "",
                    url: actionUrl ? String(actionUrl) : (playableUrl ? String(playableUrl) : (previewUrl ? String(previewUrl) : "")),
                    image: previewUrl ? String(previewUrl) : "",
                    playableUrl: playableUrl ? String(playableUrl) : null,
                    description: unwrapLsVal(args[58]) ? String(unwrapLsVal(args[58])) : ""
                });
            }
        } else if (procName === "insertAttachmentItem") {
            const mid = unwrapLsVal(args[4]);
            if (!targetMid || mid === targetMid || String(mid).includes(String(targetMid))) {
                const title = unwrapLsVal(args[6]) || unwrapLsVal(args[7]) || unwrapLsVal(args[8]);
                const imageUrl = unwrapLsVal(args[19]) || unwrapLsVal(args[13]) || unwrapLsVal(args[14]);
                const originalUrl = unwrapLsVal(args[24]) || unwrapLsVal(args[8]) || unwrapLsVal(args[19]);
                if (imageUrl || originalUrl || title) {
                    attachments.push({
                        type: "share",
                        title: title ? String(title) : "",
                        url: originalUrl ? String(originalUrl) : (imageUrl ? String(imageUrl) : ""),
                        image: imageUrl ? String(imageUrl) : ""
                    });
                }
            }
        } else if (procName === "insertBlobAttachment") {
            const blobMid = unwrapLsVal(args[32]);
            if (!targetMid || blobMid === targetMid || String(blobMid).includes(String(targetMid))) {
                const fbid = String(unwrapLsVal(args[34]) || "");
                const filename = String(unwrapLsVal(args[0]) || "");
                const playableUrl = unwrapLsVal(args[3]);
                const previewUrl = unwrapLsVal(args[8]) || unwrapLsVal(args[45]);
                const mimeType = String(unwrapLsVal(args[6]) || unwrapLsVal(args[30]) || "image/jpeg");
                const filesize = Number(unwrapLsVal(args[1]) || 0);
                if (playableUrl || previewUrl || fbid) {
                    attachments.push({
                        type: mimeType.startsWith("video") ? "video" : (mimeType.startsWith("audio") ? "audio" : "photo"),
                        ID: fbid,
                        filename: filename,
                        fileSize: filesize,
                        mimeType: mimeType,
                        url: String(playableUrl || previewUrl || ""),
                        previewUrl: String(previewUrl || playableUrl || "")
                    });
                }
            }
        } else if (procName === "insertStickerAttachment") {
            const mid = unwrapLsVal(args[18]);
            if (!targetMid || mid === targetMid || String(mid).includes(String(targetMid))) {
                const stickerId = String(unwrapLsVal(args[19]) || unwrapLsVal(args[27]) || "");
                const animatedUrl = unwrapLsVal(args[0]);
                const staticUrl = unwrapLsVal(args[4]);
                const desc = unwrapLsVal(args[13]);
                attachments.push({
                    type: "sticker",
                    ID: stickerId,
                    url: String(animatedUrl || staticUrl || (stickerId ? `https://static.xx.fbcdn.net/rsrc.php/v3/y4/r/${stickerId}.png` : "")),
                    caption: desc ? String(desc) : "",
                    description: desc ? String(desc) : ""
                });
            }
        }
    });

    return attachments;
}

function handleLsStepProc(procName, args, jsonMessage, ctx, callback) {
    if (ctx._dead || !args || !Array.isArray(args)) return;

    const pName = String(procName || "").toLowerCase();

    if (
        pName === "insertmessage" ||
        pName === "upsertmessage" ||
        pName === "deletetheninsertmessage" ||
        pName === "lsupsertmessage" ||
        pName === "lsinsertmessage" ||
        pName === "lsdeletetheninsertmessage"
    ) {
        const rawThreadID = unwrapLsVal(args[3]);
        const threadID = formatID(String(rawThreadID != null ? rawThreadID : ""));
        const messageID = String(unwrapLsVal(args[8]) || "");
        const rawSenderID = unwrapLsVal(args[10]);
        const senderID = formatID(String(rawSenderID != null ? rawSenderID : ""));
        const rawBody = unwrapLsVal(args[0]);
        const body = rawBody != null ? String(rawBody) : "";
        const timestamp = Number(unwrapLsVal(args[5]) || Date.now());
        const isGroup = String(threadID) !== String(senderID);

        if (!messageID || !threadID || threadID === "0") return;
        if (!ctx.options?.selfListen && ctx.userID && formatID(senderID) === formatID(ctx.userID)) {
            return;
        }

        const mentions = {};
        const mOffset = unwrapLsVal(args[19]);
        const mLength = unwrapLsVal(args[20]);
        const mUser = unwrapLsVal(args[21]);
        if (mOffset != null && mLength != null && mUser != null) {
            const off = parseInt(mOffset, 10);
            const len = parseInt(mLength, 10);
            if (!isNaN(off) && !isNaN(len) && off >= 0 && off + len <= body.length) {
                mentions[String(mUser)] = body.substring(off, off + len);
            }
        }

        const step = (jsonMessage && jsonMessage.payload && jsonMessage.payload.step) ||
                     (jsonMessage && jsonMessage.step) ||
                     (jsonMessage && jsonMessage.payload) ||
                     jsonMessage;
        const attachments = extractAttachmentsFromStep(step, messageID);

        const rawStickerId = unwrapLsVal(args[11]);
        if (rawStickerId && attachments.length === 0) {
            attachments.push({
                type: "sticker",
                ID: String(rawStickerId),
                url: `https://static.xx.fbcdn.net/rsrc.php/v3/y4/r/${rawStickerId}.png`,
                caption: "",
                description: ""
            });
        }

        const replyMid = unwrapLsVal(args[23]);
        const isReply = Boolean(replyMid);

        let finalBody = body;
        if (!finalBody || finalBody.trim() === "") {
            const shareAttach = attachments.find(a => (a.type === "share" || a.type === "url") && a.url && (a.url.startsWith("http://") || a.url.startsWith("https://")));
            if (shareAttach) finalBody = shareAttach.url;
        }

        if (!finalBody && Array.isArray(args)) {
            for (let a of args) {
                let u = unwrapLsVal(a);
                if (typeof u === "string" && (u.startsWith("http://") || u.startsWith("https://"))) {
                    if (u.includes("l.facebook.com/l.php?u=") || u.includes("facebook.com/l.php") || u.includes("?u=") || u.includes("&u=")) {
                        try {
                            const uMatch = u.match(/[?&]u=([^&]+)/);
                            if (uMatch && uMatch[1]) u = decodeURIComponent(uMatch[1]);
                        } catch (_) {}
                    }
                    u = u.replace(/([?&])(?:fbclid|h|__tn__|__xts__)=[^&]*/g, "$1").replace(/[?&]$/, "");
                    if (!u.includes("fbcdn.net") && !u.includes("facebook.com/rsrc.php")) {
                        finalBody = u;
                        break;
                    }
                }
            }
        }

        if (finalBody && (finalBody.startsWith("http://") || finalBody.startsWith("https://")) && attachments.length === 0) {
            attachments.push({
                type: "share",
                url: finalBody,
                facebookUrl: finalBody,
                title: "",
                description: "",
                image: ""
            });
        }

        if (!finalBody && (!attachments || attachments.length === 0)) {
            return;
        }

        recordDatabaseInfo(senderID, null, threadID, null, isGroup);

        const fmtMsg = {
            type: isReply ? "message_reply" : "message",
            senderID: senderID,
            body: finalBody,
            args: finalBody === "" ? [] : finalBody.trim().split(/\s+/),
            threadID: threadID,
            messageID: messageID,
            attachments: attachments,
            mentions: mentions,
            timestamp: timestamp,
            isGroup: isGroup,
            participantIDs: [senderID],
            offlineThreadingID: String(unwrapLsVal(args[9]) || "")
        };

        if (isReply) {
            const rawReplyMid = String(replyMid || "");
            const replyBody = String(unwrapLsVal(args[28]) || "");
            const replySenderID = formatID(String(unwrapLsVal(args[29]) || ""));
            const replyTimestamp = Number(unwrapLsVal(args[59]) || 0);

            fmtMsg.messageReply = {
                messageID: rawReplyMid,
                senderID: replySenderID,
                body: replyBody,
                args: replyBody === "" ? [] : replyBody.trim().split(/\s+/),
                threadID: threadID,
                attachments: [],
                mentions: {},
                timestamp: replyTimestamp || timestamp,
                isGroup: isGroup,
                participantIDs: replySenderID ? [replySenderID] : []
            };

            const replyMediaUrl = unwrapLsVal(args[31]);
            if (replyMediaUrl) {
                fmtMsg.messageReply.attachments.push({
                    type: "share",
                    url: String(replyMediaUrl)
                });
            }
        }

        callback(null, fmtMsg);
        return;
    }

    if (pName === "upsertreaction") {
        const rawThreadID = unwrapLsVal(args[0]);
        const threadID = formatID(String(rawThreadID != null ? rawThreadID : ""));
        const messageID = String(unwrapLsVal(args[2]) || "");
        const rawUserID = unwrapLsVal(args[3]);
        const userID = formatID(String(rawUserID != null ? rawUserID : ""));
        const reaction = String(unwrapLsVal(args[4]) || "");
        const timestamp = Number(unwrapLsVal(args[1]) || Date.now());

        if (threadID && messageID) {
            callback(null, {
                type: "message_reaction",
                threadID: threadID,
                messageID: messageID,
                senderID: userID,
                userID: userID,
                reaction: reaction,
                timestamp: timestamp
            });
        }
        return;
    }

    if (pName === "updatetypingindicator") {
        const rawThreadID = unwrapLsVal(args[0]);
        const threadID = formatID(String(rawThreadID != null ? rawThreadID : ""));
        const from = formatID(String(unwrapLsVal(args[1]) || ""));
        const isTyping = Boolean(unwrapLsVal(args[2]));
        if (threadID && from) {
            callback(null, {
                type: "typ",
                isTyping: isTyping,
                from: from,
                threadID: threadID
            });
        }
        return;
    }

    if (pName === "setpinnedmessage" || pName === "setsunsetpinnedmessage") {
        const rawThreadID = unwrapLsVal(args[0]);
        const threadID = formatID(String(rawThreadID != null ? rawThreadID : ""));
        const messageID = String(unwrapLsVal(args[1]) || "");
        if (threadID && messageID) {
            callback(null, {
                type: "event",
                threadID: threadID,
                logMessageType: "log:pinned-message",
                logMessageData: { messageID: messageID, isPinned: true }
            });
        }
        return;
    }

    if (pName === "deletemessage" || pName === "cleanuponrecall" || pName === "handlerepliesonunsend") {
        const messageID = String(unwrapLsVal(args[0]) || "");
        const rawThreadID = unwrapLsVal(args[1]) || unwrapLsVal(args[0]);
        const threadID = formatID(String(rawThreadID != null ? rawThreadID : ""));
        if (messageID && messageID.startsWith("mid.")) {
            callback(null, {
                type: "message_unsend",
                threadID: threadID,
                messageID: messageID,
                deletionTimestamp: Date.now()
            });
        }
        return;
    }

    if (pName === "syncupdatethreadname") {
        const threadName = String(unwrapLsVal(args[0]) || "");
        const threadID = formatID(String(unwrapLsVal(args[1]) || ""));
        callback(null, {
            type: "event",
            threadID: threadID,
            logMessageType: "log:thread-name",
            logMessageData: { name: threadName }
        });
        return;
    }

    if (pName === "updatethreadcustomemoji") {
        const threadID = formatID(String(unwrapLsVal(args[0]) || ""));
        const emoji = String(unwrapLsVal(args[1]) || "");
        callback(null, {
            type: "event",
            threadID: threadID,
            logMessageType: "log:thread-icon",
            logMessageData: { thread_icon: emoji }
        });
        return;
    }

    if (pName === "updatethreadtheme") {
        const threadID = formatID(String(unwrapLsVal(args[0]) || ""));
        const themeID = String(unwrapLsVal(args[1]) || "");
        callback(null, {
            type: "event",
            threadID: threadID,
            logMessageType: "log:thread-color",
            logMessageData: { theme_id: themeID }
        });
        return;
    }

    if (pName === "setthreadimageurl") {
        const threadID = formatID(String(unwrapLsVal(args[0]) || ""));
        const imgUrl = String(unwrapLsVal(args[1]) || "");
        callback(null, {
            type: "event",
            threadID: threadID,
            logMessageType: "log:thread-image",
            logMessageData: { image: { url: imgUrl } }
        });
        return;
    }

    if (pName === "addparticipantidtogroupthread" || pName === "lsaddparticipantidtogroupthread") {
        const threadID = formatID(String(unwrapLsVal(args[0]) || ""));
        const contactID = formatID(String(unwrapLsVal(args[1]) || ""));
        const nickname = unwrapLsVal(args[5]);
        const isAdmin = Boolean(
            args[13] === true || args[13] === 1 || String(args[13]) === "true" ||
            String(args[7] || "").toLowerCase().includes("creator") || String(args[7] || "").toLowerCase().includes("admin") ||
            unwrapLsVal(args[6]) === true || unwrapLsVal(args[6]) === 1 || unwrapLsVal(args[6]) === "1"
        );
        if (threadID && contactID) {
            if (global.Fca && global.Fca.isThread) {
                const cached = global.Fca.isThread.get(threadID) || {};
                cached.participantIDs = Array.isArray(cached.participantIDs) ? cached.participantIDs : [];
                if (!cached.participantIDs.includes(contactID)) cached.participantIDs.push(contactID);
                cached.adminIDs = Array.isArray(cached.adminIDs) ? cached.adminIDs : [];
                if (isAdmin) {
                    if (!cached.adminIDs.some(a => (a.id || a) == contactID)) cached.adminIDs.push({ id: contactID });
                }
                cached.userInfo = Array.isArray(cached.userInfo) ? cached.userInfo : [];
                if (!cached.userInfo.some(u => (u.id || u) == contactID)) {
                    cached.userInfo.push({ id: contactID, name: nickname ? String(nickname) : "Facebook User" });
                }
                global.Fca.isThread.set(threadID, cached);
            }

            callback(null, {
                type: "event",
                threadID: threadID,
                logMessageType: "log:subscribe",
                logMessageData: {
                    addedParticipants: [{
                        userFbId: contactID,
                        fullName: nickname ? String(nickname) : "",
                        isAdmin: isAdmin
                    }]
                }
            });
        }
        return;
    }

    if (pName === "updatethreadparticipantadminstatus") {
        const threadID = formatID(String(unwrapLsVal(args[0]) || ""));
        const contactID = formatID(String(unwrapLsVal(args[1]) || ""));
        const rawAdmin = unwrapLsVal(args[2]);
        const isAdmin = Boolean(rawAdmin === 1 || rawAdmin === true || rawAdmin === "1");
        if (threadID && contactID && global.Fca && global.Fca.isThread) {
            const cached = global.Fca.isThread.get(threadID) || {};
            cached.adminIDs = Array.isArray(cached.adminIDs) ? cached.adminIDs : [];
            if (isAdmin) {
                if (!cached.adminIDs.some(a => (a.id || a) == contactID)) cached.adminIDs.push({ id: contactID });
            } else {
                cached.adminIDs = cached.adminIDs.filter(a => (a.id || a) != contactID);
            }
            global.Fca.isThread.set(threadID, cached);
        }
        return;
    }

    if (pName === "updatereadreceipt" || pName === "markthreadreadv2") {
        const time = Number(unwrapLsVal(args[0]) || Date.now());
        const threadID = formatID(String(unwrapLsVal(args[1]) || ""));
        const reader = formatID(String(unwrapLsVal(args[2]) || ""));
        if (threadID) {
            callback(null, {
                type: "read_receipt",
                threadID: threadID,
                reader: reader,
                time: time
            });
        }
        return;
    }

    if (pName === "deletetheninsertcontact" || pName === "lsdeletetheninsertcontact" || pName === "verifycontactrowexists") {
        return;
    }

    if (pName === "deletetheninsertthread" || pName === "lsdeletetheninsertthread" || pName === "updateorinsertthread") {
        return;
    }

    if (pName === "executefirstblockforsynctransactionv4" || pName === "executefirstblockforsynctransaction") {
        try {
            const db = unwrapLsVal(args[0]);
            const epochId = unwrapLsVal(args[1]);
            const cursor = unwrapLsVal(args[3]) || unwrapLsVal(args[2]);
            if (db != null && cursor && cursor !== "dummy_cursor" && cursor !== "-1") {
                if (!ctx._ackedCursors) ctx._ackedCursors = new Set();
                const ackKey = `${db}:${cursor}`;
                if (!ctx._ackedCursors.has(ackKey)) {
                    ctx._ackedCursors.add(ackKey);
                    if (ctx._ackedCursors.size > 500) {
                        const first = ctx._ackedCursors.values().next().value;
                        ctx._ackedCursors.delete(first);
                    }
                    if (typeof ctx._sendMqttSyncAck === "function") {
                        ctx._sendMqttSyncAck(db, epochId, cursor);
                    }
                }
            }
        } catch (_) {}
        return;
    }
}

module.exports = function(ctx, http, api) {
    return function listenMqtt(callback) {
        if (typeof callback !== "function") throw new Error("listenMqtt cần callback");

        const emitter = new EventEmitter();
        emitter.stopListening = function(cb) {
            if (ctx.mqttClient) {
                try {
                    ctx.mqttClient.publish("/browser_close", "{}");
                    ctx.mqttClient.end(true);
                } catch (_) {}
            }
            if (ctx.gatewayClient) {
                try { ctx.gatewayClient.close(); } catch (_) {}
            }
            if (typeof cb === "function") cb();
        };

        if (ctx._dead) {
            setImmediate(() => {
                if (emitter.listenerCount("error") > 0) {
                    emitter.emit("error", { error: "Session đã die" });
                }
                callback({ error: "Session đã die" });
            });
            return emitter;
        }

        const globalCb = (err, data) => {
            if (err) {
                if (emitter.listenerCount("error") > 0) {
                    emitter.emit("error", err);
                }
                return callback(err);
            }
            if (data) {
                if (isDuplicateEvent(data)) return;
                emitter.emit("message", data);
                return callback(null, data);
            }
        };

        if (ctx.options?.useDgw && !ctx.gatewayClient) {
            try {
                const gw = new DgwGatewayClient(ctx);
                ctx.gatewayClient = gw;
                gw.on("stepProc", ({ procName, args, raw }) => {
                    handleLsStepProc(procName, args, raw, ctx, globalCb);
                });
                gw.connect();
            } catch (e) {
                logger.Warn("DGW Gateway: " + (e.message || e));
            }
        }

        connectMqtt(ctx, {
            onStepProc: (procName, args, raw) => handleLsStepProc(procName, args, raw, ctx, globalCb),
            onDelta:    (delta, raw) => parseDelta(ctx, delta, globalCb),
            onTyping:   (data) => globalCb(null, data),
            onPresence: (data) => globalCb(null, data),
            onReady:    () => {
                if (ctx.options?.emitReady) globalCb(null, { type: "ready", error: null });
            },
            onError:    (err) => globalCb(err)
        });

        return emitter;
    };
};
