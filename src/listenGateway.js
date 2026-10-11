"use strict";

const utils = require("../utils");
const log = require("npmlog");
const { createGatewayClient } = require("./lightspeedGateway");

module.exports = function (defaultFuncs, api, ctx) {
    let gatewayClient = null;

    return function listenGateway(callback) {
        if (typeof callback !== "function") {
            throw new Error("listenGateway requires a callback function");
        }

        if (!gatewayClient) {
            gatewayClient = createGatewayClient(ctx, defaultFuncs);
            ctx.gatewayClient = gatewayClient;
        }

        gatewayClient.on("stepProc", ({ procName, args, streamID, raw }) => {
            try {
                handleGatewayStepProc(procName, args, raw, callback, ctx);
            } catch (err) {
                log.error("listenGateway", "Error handling stepProc:", err);
            }
        });

        gatewayClient.on("error", (err) => {
            log.error("listenGateway", "Gateway client error:", err);
        });

        gatewayClient.connect().catch((err) => {
            log.error("listenGateway", "Failed to connect to Lightspeed Gateway:", err);
        });

        const stopListening = () => {
            if (gatewayClient) {
                gatewayClient.close();
                gatewayClient = null;
                ctx.gatewayClient = null;
            }
        };

        return stopListening;
    };
};

function extractAttachmentsFromStep(step, targetMid) {
    const attachments = [];
    if (!step) return attachments;
    utils.walkLsStep(step, (procName, args) => {
        if (procName === "insertBlobAttachment") {
            const blobId = utils.unwrapLsVal(args[0]);
            const previewUrl = utils.unwrapLsVal(args[3]) || utils.unwrapLsVal(args[8]);
            const mimeType = String(utils.unwrapLsVal(args[6]) || "image/jpeg");
            if (previewUrl) {
                attachments.push({
                    type: mimeType.startsWith("video") ? "video" : (mimeType.startsWith("audio") ? "audio" : "photo"),
                    ID: String(blobId || ""),
                    url: String(previewUrl),
                    previewUrl: String(previewUrl)
                });
            }
        } else if (procName === "insertAttachmentItem") {
            const mid = utils.unwrapLsVal(args[4]);
            if (!targetMid || mid === targetMid) {
                const title = utils.unwrapLsVal(args[8]);
                const imageUrl = utils.unwrapLsVal(args[18]) || utils.unwrapLsVal(args[52]);
                const originalUrl = utils.unwrapLsVal(args[19]);
                if (imageUrl || originalUrl) {
                    attachments.push({
                        type: "share",
                        title: title ? String(title) : "",
                        url: originalUrl ? String(originalUrl) : (imageUrl ? String(imageUrl) : ""),
                        image: imageUrl ? String(imageUrl) : ""
                    });
                }
            }
        } else if (procName === "insertStickerAttachment") {
            const mid = utils.unwrapLsVal(args[18]);
            if (!targetMid || mid === targetMid) {
                const stickerId = utils.unwrapLsVal(args[19]);
                const animatedUrl = utils.unwrapLsVal(args[0]);
                const staticUrl = utils.unwrapLsVal(args[4]);
                const desc = utils.unwrapLsVal(args[13]);
                attachments.push({
                    type: "sticker",
                    ID: String(stickerId || ""),
                    url: String(animatedUrl || staticUrl || ""),
                    caption: desc ? String(desc) : "",
                    description: desc ? String(desc) : ""
                });
            }
        } else if (procName === "insertXmaAttachment") {
            const mid = utils.unwrapLsVal(args[30]);
            if (!targetMid || mid === targetMid) {
                const title = utils.unwrapLsVal(args[44]);
                const previewUrl = utils.unwrapLsVal(args[7]);
                const previewUrlFallback = utils.unwrapLsVal(args[8]);
                const playableUrl = utils.unwrapLsVal(args[3]);
                attachments.push({
                    type: "share",
                    title: title ? String(title) : "",
                    url: playableUrl ? String(playableUrl) : (previewUrl || previewUrlFallback || ""),
                    image: previewUrl ? String(previewUrl) : ""
                });
            }
        }
    });
    return attachments;
}

function handleGatewayStepProc(procName, args, raw, callback, ctx) {
    if (!args || !Array.isArray(args)) return;

    if (procName === "insertMessage" || procName === "upsertMessage" || procName === "deleteThenInsertMessage") {
        const rawThreadID = utils.unwrapLsVal(args[3]);
        const threadID = utils.formatID(String(rawThreadID != null ? rawThreadID : ""));
        const messageID = String(utils.unwrapLsVal(args[8]) || "");
        const rawSenderID = utils.unwrapLsVal(args[10]);
        const senderID = String(rawSenderID != null ? rawSenderID : "");
        const rawBody = utils.unwrapLsVal(args[0]);
        const body = rawBody != null ? String(rawBody) : "";
        const timestamp = Number(utils.unwrapLsVal(args[5]) || Date.now());
        const isGroup = String(threadID) !== String(senderID);

        if (threadID && messageID) {
            if (utils.formatID(senderID) === utils.formatID(ctx.userID) && !ctx.globalOptions?.selfListen) {
                return;
            }

            const mentions = {};
            const mOffset = utils.unwrapLsVal(args[19]);
            const mLength = utils.unwrapLsVal(args[20]);
            const mUser = utils.unwrapLsVal(args[21]);
            if (mOffset != null && mLength != null && mUser != null) {
                const off = parseInt(mOffset, 10);
                const len = parseInt(mLength, 10);
                if (!isNaN(off) && !isNaN(len) && off >= 0 && off + len <= body.length) {
                    mentions[String(mUser)] = body.substring(off, off + len);
                }
            }

            const step = raw?.payload?.step || raw?.step;
            const attachments = extractAttachmentsFromStep(step, messageID);

            const replyMid = utils.unwrapLsVal(args[23]);
            const isReply = Boolean(replyMid);

            const msgObj = {
                type: isReply ? "message_reply" : "message",
                body: body,
                args: body === "" ? [] : body.trim().split(/\s+/),
                threadID: String(threadID),
                messageID: String(messageID),
                senderID: senderID ? String(senderID) : ctx.userID,
                timestamp: timestamp,
                attachments: attachments,
                mentions: mentions,
                isGroup: isGroup,
                participantIDs: [senderID ? String(senderID) : ctx.userID],
                offlineThreadingID: String(utils.unwrapLsVal(args[9]) || "")
            };

            if (isReply) {
                msgObj.messageReply = {
                    messageID: String(replyMid),
                    senderID: String(utils.unwrapLsVal(args[29]) || ""),
                    body: String(utils.unwrapLsVal(args[28]) || "")
                };
            }

            callback(null, msgObj);
        }
    } else if (procName === "upsertReaction" || procName === "updateOrInsertReactionV2") {
        const rawThreadID = utils.unwrapLsVal(args[0]);
        const threadID = utils.formatID(String(rawThreadID != null ? rawThreadID : ""));
        const messageID = String(utils.unwrapLsVal(args[2]) || utils.unwrapLsVal(args[1]) || "");
        const rawUserID = utils.unwrapLsVal(args[3]) || utils.unwrapLsVal(args[2]);
        const userID = String(rawUserID != null ? rawUserID : "");
        const reaction = String(utils.unwrapLsVal(args[4]) || "");
        const timestamp = Number(utils.unwrapLsVal(args[1]) || Date.now());

        if (threadID && messageID) {
            callback(null, {
                type: "message_reaction",
                threadID: threadID,
                messageID: messageID,
                userID: userID,
                reaction: reaction,
                timestamp: timestamp
            });
        }
    } else if (procName === "updateTypingIndicator") {
        const rawThreadID = utils.unwrapLsVal(args[0]);
        const threadID = utils.formatID(String(rawThreadID != null ? rawThreadID : ""));
        const from = String(utils.unwrapLsVal(args[1]) || "");
        const isTyping = Boolean(utils.unwrapLsVal(args[2]));
        if (threadID && from) {
            callback(null, {
                type: "typ",
                isTyping: isTyping,
                from: from,
                threadID: threadID
            });
        }
    } else if (procName === "setPinnedMessage") {
        const rawThreadID = utils.unwrapLsVal(args[0]);
        const threadID = utils.formatID(String(rawThreadID != null ? rawThreadID : ""));
        const messageID = String(utils.unwrapLsVal(args[1]) || "");
        if (threadID && messageID) {
            callback(null, {
                type: "event",
                threadID: threadID,
                logMessageType: "log:pinned-message",
                logMessageData: { messageID: messageID, isPinned: true }
            });
        }
    } else if (procName === "deleteMessage" || procName === "cleanUpOnRecall" || procName === "handleRepliesOnUnsend" || procName === "deleteMessageRequest") {
        const rawThreadID = utils.unwrapLsVal(args[1]) || utils.unwrapLsVal(args[0]);
        const threadID = utils.formatID(String(rawThreadID != null ? rawThreadID : ""));
        const messageID = String(utils.unwrapLsVal(args[0]) || utils.unwrapLsVal(args[1]) || "");
        if (messageID) {
            callback(null, {
                type: "message_unsend",
                messageID: messageID,
                threadID: threadID ? String(threadID) : null,
                deletionTimestamp: Date.now()
            });
        }
    } else if (procName === "syncUpdateThreadName") {
        const newTitle = String(utils.unwrapLsVal(args[0]) || "");
        const threadID = utils.formatID(String(utils.unwrapLsVal(args[1]) || ""));
        if (threadID) {
            callback(null, {
                type: "event",
                threadID: String(threadID),
                logMessageType: "log:thread-name",
                logMessageData: { name: newTitle },
                author: ctx.userID
            });
        }
    } else if (procName === "updateThreadCustomEmoji") {
        const threadID = utils.formatID(String(utils.unwrapLsVal(args[0]) || ""));
        const emoji = String(utils.unwrapLsVal(args[1]) || "");
        if (threadID) {
            callback(null, {
                type: "event",
                threadID: String(threadID),
                logMessageType: "log:thread-icon",
                logMessageData: { thread_icon: emoji },
                author: ctx.userID
            });
        }
    } else if (procName === "updateThreadTheme") {
        const threadID = utils.formatID(String(utils.unwrapLsVal(args[0]) || ""));
        const themeFbid = String(utils.unwrapLsVal(args[1]) || "");
        if (threadID) {
            callback(null, {
                type: "event",
                threadID: String(threadID),
                logMessageType: "log:thread-color",
                logMessageData: { theme_fbid: themeFbid },
                author: ctx.userID
            });
        }
    } else if (procName === "addParticipantIdToGroupThread") {
        const threadID = utils.formatID(String(utils.unwrapLsVal(args[0]) || ""));
        const userID = String(utils.unwrapLsVal(args[1]) || "");
        if (threadID && userID) {
            callback(null, {
                type: "event",
                threadID: String(threadID),
                logMessageType: "log:subscribe",
                logMessageData: { addedParticipants: [{ userFbId: userID }] },
                author: ctx.userID
            });
        }
    } else if (procName === "updateReadReceipt" || procName === "markThreadReadV2") {
        const threadID = utils.formatID(String(utils.unwrapLsVal(args[1]) || utils.unwrapLsVal(args[0]) || ""));
        const watermark = Number(utils.unwrapLsVal(args[0]) || Date.now());
        if (threadID) {
            callback(null, {
                type: "read_receipt",
                threadID: String(threadID),
                time: watermark
            });
        }
    } else if (procName === "updateOrInsertEditMessageHistory" || procName === "editMessage" || procName === "handleRepliesOnMessageEdit") {
        const rawMid = utils.unwrapLsVal(args[0]);
        const messageID = String(rawMid || "");
        const rawBody = utils.unwrapLsVal(args[3]) || utils.unwrapLsVal(args[2]) || "";
        const rawThreadID = utils.unwrapLsVal(args[1]);
        const threadID = utils.formatID(String(rawThreadID != null ? rawThreadID : ""));
        if (messageID) {
            callback(null, {
                type: "message_edit",
                messageID: messageID,
                threadID: threadID || null,
                body: String(rawBody),
                timestamp: Number(utils.unwrapLsVal(args[2])) || Date.now()
            });
        }
    } else if (procName === "removeParticipantFromThread") {
        const rawThreadID = utils.unwrapLsVal(args[0]);
        const threadID = utils.formatID(String(rawThreadID != null ? rawThreadID : ""));
        const rawContactID = utils.unwrapLsVal(args[1]);
        const contactID = utils.formatID(String(rawContactID != null ? rawContactID : ""));
        if (threadID && contactID) {
            callback(null, {
                type: "event",
                threadID: threadID,
                logMessageType: "log:unsubscribe",
                logMessageData: { leftParticipantFbId: contactID },
                author: contactID
            });
        }
    } else if (
        procName === "updateThreadParticipantAdminStatus" ||
        procName === "LSUpdateThreadParticipantAdminStatus" ||
        String(procName || "").toLowerCase().includes("participantadminstatus")
    ) {
        const rawThreadID = utils.unwrapLsVal(args[0]);
        const threadID = utils.formatID(String(rawThreadID != null ? rawThreadID : ""));
        const rawContactID = utils.unwrapLsVal(args[1]);
        const contactID = utils.formatID(String(rawContactID != null ? rawContactID : ""));
        const rawAdmin = utils.unwrapLsVal(args[2]);
        const isAdmin = Boolean(rawAdmin === 1 || rawAdmin === true || rawAdmin === "1");
        if (threadID && contactID) {
            if (global.Fca && global.Fca.isThread) {
                const cached = global.Fca.isThread.get(threadID) || {};
                cached.adminIDs = Array.isArray(cached.adminIDs) ? cached.adminIDs : [];
                if (isAdmin) {
                    if (!cached.adminIDs.some(function(a) { return (a.id || a) == contactID; })) {
                        cached.adminIDs.push({ id: contactID });
                    }
                } else {
                    cached.adminIDs = cached.adminIDs.filter(function(a) { return (a.id || a) != contactID; });
                }
                global.Fca.isThread.set(threadID, cached);
            }

            try {
                var extraModGw = require('../shiina/Extra/Shiina-GetThread');
                if (extraModGw.hasData(threadID)) {
                    var exDataGw = extraModGw.getData(threadID);
                    if (exDataGw) {
                        exDataGw.adminIDs = Array.isArray(exDataGw.adminIDs) ? exDataGw.adminIDs : [];
                        if (isAdmin) {
                            if (!exDataGw.adminIDs.some(function(a) { return (a.id || a) == contactID; })) {
                                exDataGw.adminIDs.push({ id: contactID });
                            }
                        } else {
                            exDataGw.adminIDs = exDataGw.adminIDs.filter(function(a) { return (a.id || a) != contactID; });
                        }
                        extraModGw.updateData(threadID, exDataGw);
                    }
                }
            } catch (_) {}

            callback(null, {
                type: "event",
                threadID: threadID,
                logMessageType: "log:thread-admins",
                logMessageData: {
                    TARGET_ID: contactID,
                    ADMIN_EVENT: isAdmin ? "add_admin" : "remove_admin"
                }
            });
        }
    } else if (procName === "deleteReaction") {
        const rawThreadID = utils.unwrapLsVal(args[0]);
        const threadID = utils.formatID(String(rawThreadID != null ? rawThreadID : ""));
        const messageID = String(utils.unwrapLsVal(args[1]) || "");
        const rawUserID = utils.unwrapLsVal(args[2]);
        const userID = utils.formatID(String(rawUserID != null ? rawUserID : ""));
        if (threadID && messageID) {
            callback(null, {
                type: "message_reaction",
                threadID: threadID,
                messageID: messageID,
                userID: userID,
                reaction: "",
                timestamp: Date.now()
            });
        }
    } else if (procName === "clearPinnedMessages") {
        const rawThreadID = utils.unwrapLsVal(args[0]);
        const threadID = utils.formatID(String(rawThreadID != null ? rawThreadID : ""));
        if (threadID) {
            callback(null, {
                type: "event",
                threadID: threadID,
                logMessageType: "log:unpinned-message",
                logMessageData: { isPinned: false }
            });
        }
    } else if (procName === "addPollForThread" || procName === "addPollOption") {
        const pollID = String(utils.unwrapLsVal(args[0]) || "");
        const rawThreadID = utils.unwrapLsVal(args[1]);
        const threadID = utils.formatID(String(rawThreadID != null ? rawThreadID : ""));
        const title = procName === "addPollOption" ? String(utils.unwrapLsVal(args[2]) || "") : "";
        if (threadID) {
            callback(null, {
                type: "event",
                threadID: threadID,
                logMessageType: "log:poll",
                logMessageData: {
                    poll_id: pollID,
                    title: title
                }
            });
        }
    } else if (procName === "addPollVote") {
        const optionID = String(utils.unwrapLsVal(args[0]) || "");
        const pollID = String(utils.unwrapLsVal(args[1]) || "");
        const contactID = utils.formatID(String(utils.unwrapLsVal(args[2]) || ""));
        callback(null, {
            type: "event",
            logMessageType: "log:poll-vote",
            logMessageData: {
                poll_id: pollID,
                option_id: optionID,
                user_id: contactID
            }
        });
    }
}
