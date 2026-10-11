"use strict";

var utils = require("../utils");
var log = require("npmlog");
var bluebird = require("bluebird");
var fs = require("fs-extra");
const { Readable } = require("stream");

// ─── EFFECT CONSTANTS ────────────────────────────────────────────────────────

const EFFECTS = {
  LOVE:        1,
  GIFTWRAP:    2,
  CELEBRATION: 3,
  FIRE:        4,
};

function normalizeEffect(eff) {
  if (eff == null) return null;

  let name = null;
  let id   = null;

  if (typeof eff === "string") {
    name = eff.toUpperCase();
    id   = EFFECTS[name] || (Number.isFinite(+eff) ? +eff : null);
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
      power_up: { power_up_style: effectObj.name },
    }),
  };
}

function hasLinks(s) {
  return (
    typeof s === "string" &&
    /(https?:\/\/|www\.|t\.me\/|fb\.me\/|youtu\.be\/|facebook\.com\/|youtube\.com\/)/i.test(s)
  );
}

// ─── ALLOWED MESSAGE PROPERTIES ──────────────────────────────────────────────

var allowedProperties = {
  attachment: true,
  url:        true,
  sticker:    true,
  emoji:      true,
  emojiSize:  true,
  body:       true,
  mentions:   true,
  location:   true,
  effect:     true,
  quickReplies: true, // <--- CHO PHÉP quickReplies
};

const MEDIA_ID_TO_FORM_KEY = {
  media_id: "video_ids",
  video_id: "video_ids",
  image_id: "image_ids",
  photo_id: "image_ids",
  gif_id:   "gif_ids",
  file_id:  "file_ids",
  audio_id: "audio_ids",
};

function resolveFormKey(key) {
  if (MEDIA_ID_TO_FORM_KEY[key]) return MEDIA_ID_TO_FORM_KEY[key];
  if (key.endsWith("s")) return key;
  return key + "s";
}

function normalizeFileEntry(file) {
  if (Array.isArray(file) && file.length === 2 && typeof file[0] === "string") {
    return { [file[0]]: file[1] };
  }
  return file;
}

// ─── MQTT / EFFECT PATH ──────────────────────────────────────────────────────

function generateOfflineThreadingID() {
  if (utils && typeof utils.generateOfflineThreadingID === "function") {
    return utils.generateOfflineThreadingID();
  }
  return (BigInt(Date.now()) << 22n).toString();
}

function publishWithAck(content, text, reqID, ctx, startTimestamp, callback, otid, targetThreadID) {
  return new Promise(function(resolve, reject) {
    const rawOtid = String(otid || reqID || "");

    function handleSendSuccess() {
      const serverMid = ctx.otidToMid ? ctx.otidToMid.get(rawOtid) : null;
      const res = {
        body: text || null,
        messageID: String(serverMid || rawOtid),
        otid: rawOtid,
        threadID: String(targetThreadID || ""),
        timestamp: startTimestamp,
      };

      if (res.messageID) {
        if (!ctx.messageToThread) ctx.messageToThread = new Map();
        ctx.messageToThread.set(String(res.messageID), String(res.threadID || ""));
        if (rawOtid) ctx.messageToThread.set(rawOtid, String(res.threadID || ""));
      }

      if (callback) callback(null, res);
      resolve(res);
    }

    // 1. Ưu tiên gửi qua DGW Lightspeed Gateway nếu đang kết nối
    if (ctx.gatewayClient && ctx.gatewayClient.connected) {
      let tasksPayload = [];
      try {
        const parsed = typeof content.payload === "string" ? JSON.parse(content.payload) : content.payload;
        tasksPayload = parsed.tasks || [];
      } catch (_) {}

      ctx.gatewayClient.publishTasks(tasksPayload, {
        request_id: reqID,
        epoch_id: rawOtid
      }).then(() => {
        handleSendSuccess();
      }).catch((err) => {
        if (ctx.mqttClient && ctx.mqttClient.connected) {
          sendViaMqtt();
        } else {
          if (callback) callback(err);
          reject(err);
        }
      });
      return;
    }

    sendViaMqtt();

    function sendViaMqtt() {
      if (!ctx.mqttClient || !ctx.mqttClient.connected) {
        const err = new Error("Neither Lightspeed Gateway nor MQTT client is connected");
        if (callback) callback(err);
        return reject(err);
      }

      const reqPayload = typeof content === "string" ? content : JSON.stringify(content);
      ctx.mqttClient.publish("/ls_req", reqPayload, { qos: 1, retain: false }, function(err) {
        if (err) {
          if (callback) callback(err);
          return reject(err);
        }
        handleSendSuccess();
      });
    }
  });
}

async function sendWithEffect(msg, threadID, ctx, callback, replyToMessage) {
  const startTimestamp = Date.now();

  const isConnected = !!(
    (ctx.mqttClient && ctx.mqttClient.connected) ||
    (ctx.gatewayClient && ctx.gatewayClient.connected)
  );

  if (!isConnected) {
    const err = new Error("Lightspeed client not connected");
    if (callback) callback(err);
    throw err;
  }

  const targetThreadID = Array.isArray(threadID) ? threadID[0] : threadID;
  const baseBody = msg.body != null ? String(msg.body) : "";
  if (!ctx.req_ID) ctx.req_ID = 100;
  const reqID    = ++ctx.req_ID;
  const epoch    = (BigInt(Date.now()) << 22n).toString();
  const otid     = generateOfflineThreadingID();

  const payload0 = {
    thread_id:            String(targetThreadID),
    otid:                 otid,
    source:               65556,
    send_type:            msg.sticker ? 2 : 1,
    sync_group:           1,
    mark_thread_read:     1,
    text:                 msg.sticker && !baseBody ? null : (baseBody === "" ? null : baseBody),
    initiating_source:    1,
    skip_url_preview_gen: 0,
    text_has_links:       hasLinks(baseBody) ? 1 : 0,
    multitab_env:         0
  };

  if (msg.sticker) {
    payload0.sticker_id = Number(msg.sticker) || String(msg.sticker);
  }

  if (msg.mentions && Array.isArray(msg.mentions)) {
    payload0.mention_data = {
      mention_ids: msg.mentions.map(m => String(m.id)),
      mention_offsets: msg.mentions.map(m => Number(m.fromIndex || 0)),
      mention_lengths: msg.mentions.map(m => Number(m.length || 0)),
      mention_types: msg.mentions.map(() => "P")
    };
  }

  if (msg.quickReplies && Array.isArray(msg.quickReplies) && msg.quickReplies.length > 0) {
    const qr = msg.quickReplies.map(r => ({
      title: r.title,
      payload: r.payload || r.title,
      content_type: "text"
    }));
    payload0.quick_replies = JSON.stringify(qr);
  }

  const effectObj = normalizeEffect(msg.effect);
  if (effectObj) {
    const effectMetadata     = getEffectMetadata(effectObj);
    payload0.power_up_style  = effectMetadata.power_up_style;
    if (effectMetadata.metadata_dataclass) {
      payload0.metadata_dataclass = effectMetadata.metadata_dataclass;
    }
  }

  if (replyToMessage) {
    payload0.reply_metadata = {
      reply_source_id:            String(replyToMessage),
      reply_source_type:          1,
      reply_type:                 0,
      reply_source_attachment_id: null,
    };
  }

  const content = {
    app_id:  utils.LIGHTSPEED_APP_ID || "2220391788200892",
    payload: JSON.stringify({
      tasks: [
        {
          label:         utils.LIGHTSPEED_LABELS?.SEND_MESSAGE || "46",
          payload:       JSON.stringify(payload0),
          queue_name:    String(targetThreadID),
          task_id:       1,
          failure_count: null,
        }
      ],
      epoch_id:      epoch,
      version_id:    utils.LIGHTSPEED_VERSION_ID || "28890729100558484",
      data_trace_id:
        "#" +
        Buffer.from(String(Math.random()))
          .toString("base64")
          .replace(/=+$/, ""),
    }),
    request_id: reqID,
    type:       3,
  };

  return await publishWithAck(content, baseBody, reqID, ctx, startTimestamp, callback, otid, targetThreadID);
}

// ─── HTTP / NORMAL PATH ───────────────────────────────────────────────────────

module.exports = function (defaultFuncs, api, ctx) {
  function uploadAttachment(attachments, callback) {
    if (typeof api.uploadAttachment === "function") {
      return api.uploadAttachment(attachments, callback);
    }
    return callback({ error: "uploadAttachment is not available" });
  }

  // ─── MAIN EXPORT ─────────────────────────────────────────────────────────────

  return function sendMessage(msg, threadID, callback, replyToMessage, isGroup) {
    typeof isGroup === "undefined" ? (isGroup = null) : "";

    if (!callback && ["Function", "AsyncFunction"].includes(utils.getType(threadID))) {
      return threadID({ error: "Pass a threadID as a second argument." });
    }
    if (!replyToMessage && utils.getType(callback) === "String") {
      replyToMessage = callback;
      callback       = undefined;
    }

    var resolveFunc, rejectFunc;
    var returnPromise = new Promise(function (resolve, reject) {
      resolveFunc = resolve;
      rejectFunc  = reject;
    });
    if (!callback)
      callback = function (err, data) {
        if (err) return rejectFunc(err);
        resolveFunc(data);
      };

    if (Array.isArray(msg)) msg = { attachment: msg };
    else if (utils.getType(msg) === "String") msg = { body: msg };

    var msgType       = utils.getType(msg);
    var threadIDType  = utils.getType(threadID);
    var messageIDType = utils.getType(replyToMessage);

    if (msgType !== "Object")
      return callback({ error: "Message should be string, object, or array and not " + msgType });
    if (!["Array", "Number", "String"].includes(threadIDType))
      return callback({ error: "ThreadID should be number, string, or array and not " + threadIDType });
    if (replyToMessage && messageIDType !== "String")
      return callback({ error: "MessageID should be string and not " + threadIDType });

    var disallowedProperties = Object.keys(msg).filter((prop) => !allowedProperties[prop]);
    if (disallowedProperties.length > 0)
      return callback({ error: "Dissallowed props: `" + disallowedProperties.join(", ") + "`" });

    dispatchSend();

    function dispatchSend() {
      var targetThreadID = Array.isArray(threadID) ? threadID[0] : threadID;

      // Nếu có quickReplies
      if (msg.quickReplies && Array.isArray(msg.quickReplies) && msg.quickReplies.length > 0) {
        for (let q of msg.quickReplies) {
          if (!q.title || typeof q.title !== "string") {
            return callback({ error: "Each quick reply must have a 'title' string." });
          }
          if (!q.payload) q.payload = q.title;
        }
      }

      // Nếu có effect kiểm tra tính hợp lệ
      if (msg.effect != null) {
        const effectObj = normalizeEffect(msg.effect);
        if (!effectObj) return callback({ error: "Invalid effect: " + msg.effect });
      }

      // Nếu có file/ảnh đính kèm -> dùng sendMqttMessage (đã tích hợp upload + Lightspeed task 46)
      if (msg.attachment) {
        if (typeof api.sendMqttMessage === "function") {
          return api.sendMqttMessage(msg, targetThreadID, replyToMessage, callback);
        }
      }

      // Luồng gửi tin nhắn chuẩn Lightspeed MQTT task 46
      const isConnected = !!(
        (ctx.mqttClient && ctx.mqttClient.connected) ||
        (ctx.gatewayClient && ctx.gatewayClient.connected)
      );

      if (isConnected) {
        sendWithEffect(msg, targetThreadID, ctx, function(err, res) {
          if (err) {
            log.warn("sendMessage", "Lightspeed send failed: " + (err.message || err));
            return callback(err);
          }
          callback(null, res);
        }, replyToMessage).catch(function(err) {
          log.warn("sendMessage", "Lightspeed send error: " + (err.message || err));
          callback(err);
        });
        return;
      }

      // Nếu MQTT chưa sẵn sàng, chờ tối đa 3s để kết nối thay vì gọi HTTP cũ (tránh checkpoint)
      let waitTimer = setTimeout(() => {
        const stillConnected = !!(
          (ctx.mqttClient && ctx.mqttClient.connected) ||
          (ctx.gatewayClient && ctx.gatewayClient.connected)
        );
        if (stillConnected) {
          sendWithEffect(msg, targetThreadID, ctx, callback, replyToMessage).catch(callback);
        } else {
          const notConnErr = new Error("Lightspeed MQTT not connected, aborted legacy HTTP fallback to prevent checkpoint.");
          log.warn("sendMessage", notConnErr.message);
          callback(notConnErr);
        }
      }, 1500);

      const checkInterval = setInterval(() => {
        if ((ctx.mqttClient && ctx.mqttClient.connected) || (ctx.gatewayClient && ctx.gatewayClient.connected)) {
          clearInterval(checkInterval);
          clearTimeout(waitTimer);
          sendWithEffect(msg, targetThreadID, ctx, callback, replyToMessage).catch(callback);
        }
      }, 200);
    }

    return returnPromise;
  };
};