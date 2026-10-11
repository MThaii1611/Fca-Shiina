"use strict";

var utils = require("../utils");
var log = require("npmlog");

// Định nghĩa hiệu ứng tin nhắn
const MESSAGE_EFFECTS = {
    HEART: {
        id: "369239263222822",
        unified_id: "369239263222822",
        effect_name: "heart",
        power_up_style: 1
    },
    CELEBRATION: {
        id: "370940413392601",
        unified_id: "370940413392601",
        effect_name: "celebration",
        power_up_style: 3
    },
    CONFETTI: {
        id: "369239343222814",
        unified_id: "369239343222814",
        effect_name: "confetti",
        power_up_style: 3
    },
    LOVE: {
        id: "369239383222810",
        unified_id: "369239383222810",
        effect_name: "love",
        power_up_style: 1
    },
    FIRE: {
        id: "369239433222805",
        unified_id: "369239433222805",
        effect_name: "fire",
        power_up_style: 4
    }
};

function hasLinks(s) {
    return (
        typeof s === "string" &&
        /(https?:\/\/|www\.|t\.me\/|fb\.me\/|youtu\.be\/|facebook\.com\/|youtube\.com\/)/i.test(s)
    );
}

module.exports = function(defaultFuncs, api, ctx) {
    function uploadAttachment(attachments, callback) {
        if (typeof api.uploadAttachment === "function") {
            return api.uploadAttachment(attachments, callback);
        }
        return callback({ error: "uploadAttachment is not available" });
    }

    function handleAttachment(msg, callback, cb) {
        if (!msg.attachment) return cb(null);
        var attachments = Array.isArray(msg.attachment) ? msg.attachment : [msg.attachment];
        if (attachments.length === 2 && typeof attachments[0] === "string" && /_id$/.test(attachments[0])) {
            attachments = [attachments];
        }
        if (attachments.length === 1 && Array.isArray(attachments[0]) && attachments[0].length === 1 && Array.isArray(attachments[0][0])) {
            attachments = attachments[0];
        }
        uploadAttachment(attachments, function(err, files) {
            if (err) return callback(err);
            const fbids = [];
            files.forEach(function(file) {
                if (!file) return;
                const key = Object.keys(file)[0];
                const val = file[key];
                if (val) fbids.push(val);
            });
            return cb(fbids);
        });
    }

    return function sendMqttMessage(msg, threadID, replyToMessage, callback) {
        var resolveFunc = function() {};
        var rejectFunc = function() {};

        var returnPromise = new Promise(function(resolve, reject) {
            resolveFunc = resolve;
            rejectFunc = reject;
        });

        if (!callback && utils.getType(replyToMessage) === "Function") {
            callback = replyToMessage;
            replyToMessage = null;
        }

        if (!callback) {
            callback = function(err, data) {
                if (err) return rejectFunc(err);
                resolveFunc(data);
            };
        }

        if (Array.isArray(msg)) msg = { attachment: msg };
        else if (typeof msg === "string") msg = { body: msg };

        var msgType = utils.getType(msg);
        if (msgType !== "Object") {
            var err = { error: "Message must be a string, object, or array" };
            callback(err);
            return returnPromise;
        }

        if ((!ctx.mqttClient || !ctx.mqttClient.connected) && (!ctx.gatewayClient || !ctx.gatewayClient.connected)) {
            var mqttErr = { error: "MQTT client is not connected" };
            callback(mqttErr);
            return returnPromise;
        }

        var text = msg.body || "";
        var messageAndOTID = utils.generateOfflineThreadingID();
        var targetThreadID = Array.isArray(threadID) ? threadID[0] : threadID;

        handleAttachment(msg, callback, function(attachmentFbids) {
            var hasAtt = attachmentFbids && attachmentFbids.length > 0;
            var metaDataclass = { media_accessibility_metadata: { alt_text: null } };

            var effect = null;
            if (msg.messageEffect) {
                effect = MESSAGE_EFFECTS[String(msg.messageEffect).toUpperCase()];
                if (effect) {
                    metaDataclass.power_up = { power_up_style: effect.effect_name.toUpperCase() };
                }
            }

            var task46Payload = {
                thread_id: String(targetThreadID),
                otid: messageAndOTID,
                source: 65556,
                send_type: hasAtt ? 3 : 1,
                sync_group: 1,
                mark_thread_read: 1,
                text: hasAtt && !text ? null : text,
                initiating_source: 1,
                skip_url_preview_gen: 0,
                text_has_links: hasLinks(text) ? 1 : 0,
                multitab_env: 0,
                metadata_dataclass: JSON.stringify(metaDataclass)
            };

            if (effect && effect.power_up_style) {
                task46Payload.power_up_style = effect.power_up_style;
            }

            if (hasAtt) {
                task46Payload.attachment_fbids = attachmentFbids.map(function(id) {
                    var n = Number(id);
                    return (Number.isSafeInteger(n) && String(n) === String(id)) ? n : String(id);
                });
            }

            if (replyToMessage) {
                task46Payload.reply_metadata = {
                    reply_source_id: String(replyToMessage),
                    reply_source_type: 1,
                    reply_type: 0,
                    reply_source_attachment_id: null
                };
            }

            var tasks = [
                {
                    label: utils.LIGHTSPEED_LABELS?.SEND_MESSAGE || "46",
                    payload: task46Payload,
                    queue_name: String(targetThreadID),
                    task_id: 1,
                    failure_count: null
                },
                {
                    label: utils.LIGHTSPEED_LABELS?.MARK_READ || "21",
                    payload: {
                        thread_id: String(targetThreadID),
                        last_read_watermark_ts: Date.now(),
                        sync_group: 95,
                        offline_threading_id: null
                    },
                    queue_name: String(targetThreadID),
                    task_id: 2,
                    failure_count: null
                }
            ];

            var reqID = ++ctx.req_ID;
            var startTimestamp = Date.now();

            function handleSendSuccess() {
                const serverMid = ctx.otidToMid ? ctx.otidToMid.get(messageAndOTID) : null;
                const res = {
                    threadID: targetThreadID,
                    messageID: String(serverMid || messageAndOTID),
                    otid: messageAndOTID,
                    timestamp: startTimestamp
                };
                if (res.messageID) {
                    if (!ctx.messageToThread) ctx.messageToThread = new Map();
                    if (ctx.messageToThread.size > 5000) {
                        var firstKey = ctx.messageToThread.keys().next().value;
                        ctx.messageToThread.delete(firstKey);
                    }
                    ctx.messageToThread.set(String(res.messageID), String(res.threadID || targetThreadID));
                    ctx.messageToThread.set(messageAndOTID, String(res.threadID || targetThreadID));
                }
                callback(null, res);
                resolveFunc(res);
            }

            if (ctx.gatewayClient && ctx.gatewayClient.connected) {
                ctx.gatewayClient.publishTasks(tasks, {
                    request_id: reqID,
                    epoch_id: messageAndOTID
                }).then(() => {
                    handleSendSuccess();
                }).catch((err) => {
                    if (ctx.mqttClient && ctx.mqttClient.connected) {
                        sendThroughMqtt();
                    } else {
                        log.error("sendMqttMessage", err);
                        callback(err);
                        rejectFunc(err);
                    }
                });
                return;
            }

            sendThroughMqtt();

            function sendThroughMqtt() {
                if (!ctx.mqttClient || !ctx.mqttClient.connected) {
                    const err = new Error("Neither Lightspeed Gateway nor MQTT is connected");
                    log.error("sendMqttMessage", err);
                    callback(err);
                    return rejectFunc(err);
                }
                var content = utils.buildLsPayload(tasks, {
                    epoch_id: messageAndOTID,
                    request_id: reqID,
                    version_id: utils.LIGHTSPEED_VERSION_ID || "28736260762644663"
                });
                var reqPayload = typeof content === "string" ? content : JSON.stringify(content);
                ctx.mqttClient.publish("/ls_req", reqPayload, { qos: 1, retain: false }, function(err) {
                    if (err) {
                        log.error("sendMqttMessage", err);
                        callback(err);
                        return rejectFunc(err);
                    }
                    handleSendSuccess();
                });
            }
        });

        return returnPromise;
    };
};