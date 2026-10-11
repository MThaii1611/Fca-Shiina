"use strict";

var utils = require("../utils");
var log = require("npmlog");

module.exports = function (defaultFuncs, api, ctx) {
  function setMessageReaction(reaction, messageID, callback, forceCustom = false, threadID = null) {
    var resolveFunc = function () { };
    var rejectFunc = function () { };
    var returnPromise = new Promise(function (resolve, reject) {
      resolveFunc = resolve;
      rejectFunc = reject;
    });

    if (typeof forceCustom === "string" || typeof forceCustom === "number") {
      threadID = forceCustom;
      forceCustom = false;
    }
    if (typeof callback === "string" || typeof callback === "number") {
      var tmpThread = callback;
      callback = typeof forceCustom === "function" ? forceCustom : null;
      threadID = tmpThread;
      forceCustom = false;
    }

    if (!callback) {
      callback = function (err, data) {
        if (err) return rejectFunc(err);
        resolveFunc(data);
      };
    }

    if (!messageID) {
      var errEmpty = new Error("setMessageReaction: messageID is required");
      log.error("setMessageReaction", errEmpty.message);
      callback(errEmpty);
      return returnPromise;
    }

    messageID = String(messageID);
    if (ctx.otidToMid && ctx.otidToMid.has(messageID)) {
      messageID = ctx.otidToMid.get(messageID);
    }

    // Try finding threadID from message context cache if not provided
    if (!threadID && ctx.messageToThread) {
      if (typeof ctx.messageToThread.get === "function") {
        threadID = ctx.messageToThread.get(messageID);
        if (!threadID && ctx.midToOtid && ctx.midToOtid.has(messageID)) {
          threadID = ctx.messageToThread.get(ctx.midToOtid.get(messageID));
        }
      } else {
        threadID = ctx.messageToThread[messageID];
      }
    }

    if (!threadID && global.Fca?.Data?.event) {
      try {
        const lastEv = global.Fca.Data.event.get("Data");
        if (lastEv && lastEv.threadID) threadID = lastEv.threadID;
      } catch (_) { }
    }

    // Xử lý reaction text sang emoji
    reaction = parseReaction(reaction);

    var isLsConnected = !!(
      (ctx.mqttClient && ctx.mqttClient.connected) ||
      (ctx.gatewayClient && ctx.gatewayClient.connected)
    );

    if (!isLsConnected) {
      var errNotConn = new Error("Lightspeed is not connected. Legacy GraphQL reaction disabled to prevent checkpoint.");
      callback(errNotConn);
      rejectFunc(errNotConn);
      return returnPromise;
    }

    var targetThreadKey = threadID ? (Number(threadID) || String(threadID)) : 0;
    var task = {
      label: utils.LIGHTSPEED_LABELS?.REACTION || "29",
      payload: {
        thread_key: targetThreadKey,
        timestamp_ms: Date.now(),
        message_id: String(messageID),
        reaction: reaction || "",
        actor_id: Number(ctx.userID) || ctx.userID,
        reaction_style: null,
        sync_group: 1,
        send_attribution: Math.random() < 0.5 ? 65537 : 524289
      },
      queue_name: JSON.stringify(["reaction", String(messageID)]),
      task_id: 1,
      failure_count: null
    };

    if (ctx.mqttClient && ctx.mqttClient.connected) {
      ctx.req_ID = (ctx.req_ID || 100) + 1;
      var reqID = ctx.req_ID;
      var content = utils.buildLsPayload ? utils.buildLsPayload([task], { request_id: reqID }) : {
        app_id: utils.LIGHTSPEED_APP_ID || "2220391788200892",
        payload: JSON.stringify({
          epoch_id: (BigInt(Date.now()) << 22n).toString(),
          tasks: [{
            failure_count: null,
            label: "29",
            payload: JSON.stringify(task.payload),
            queue_name: task.queue_name,
            task_id: 1
          }],
          version_id: utils.LIGHTSPEED_VERSION_ID || "28890729100558484"
        }),
        request_id: reqID,
        type: 3
      };

      var reqPayload = typeof content === "string" ? content : JSON.stringify(content);
      ctx.mqttClient.publish("/ls_req", reqPayload, { qos: 1, retain: false }, function (err) {
        if (err) {
          log.error("setMessageReaction", "MQTT publish error: " + (err.message || err));
          callback(err);
          rejectFunc(err);
        } else {
          callback(null, { success: true });
          resolveFunc({ success: true });
        }
      });
    } else {
      utils.sendLsTask(ctx, task)
        .then(function () {
          callback(null, { success: true });
          resolveFunc({ success: true });
        })
        .catch(function (err) {
          log.error("setMessageReaction", "Lightspeed error: " + (err.message || err));
          callback(err);
          rejectFunc(err);
        });
    }

    return returnPromise;
  }

  // Hàm xử lý chuyển đổi reaction text sang emoji
  function parseReaction(reaction) {
    if (!reaction || isEmoji(reaction)) return reaction;

    const reactionMap = {
      "like": "👍",
      "love": "❤️",
      "heart": "❤",
      "haha": "😆",
      "wow": "😮", 
      "sad": "😢",
      "angry": "😠",
      ":like:": "👍",
      ":love:": "❤️",
      ":haha:": "😆",
      ":wow:": "😮",
      ":sad:": "😢", 
      ":angry:": "😠",
      "none": "",
      "remove": "",
      "clear": ""
    };

    return reactionMap[reaction.toLowerCase()] || reaction;
  }

  function isEmoji(str) {
    const emojiPattern = /(?:[\u2700-\u27bf]|(?:\ud83c[\udde6-\uddff]){2}|[\ud800-\udbff][\udc00-\udfff]|[\u0023-\u0039]\ufe0f?\u20e3|\u3299|\u3297|\u303d|\u3030|\u24c2|\ud83c[\udd70-\udd71]|\ud83c[\udd7e-\udd7f]|\ud83c\udd8e|\ud83c[\udd91-\udd9a]|\ud83c[\udde6-\uddff]|\ud83c[\ude01-\ude02]|\ud83c\ude1a|\ud83c\ude2f|\ud83c[\ude32-\ude3a]|\ud83c[\ude50-\ude51]|\u203c|\u2049|[\u25aa-\u25ab]|\u25b6|\u25c0|[\u25fb-\u25fe]|\u00a9|\u00ae|\u2122|\u2139|\ud83c\udc04|[\u2600-\u26FF]|\u2b05|\u2b06|\u2b07|\u2b1b|\u2b1c|\u2b50|\u2b55|\u231a|\u231b|\u2328|\u23cf|[\u23e9-\u23f3]|[\u23f8-\u23fa]|\ud83c\udccf|\u2934|\u2935|[\u2190-\u21ff])/;
    return emojiPattern.test(str);
  }

  return function (reaction, messageID, callback, forceCustom = false, threadID = null) {
    try {
      return setMessageReaction(reaction, messageID, callback, forceCustom, threadID);
    } catch (error) {
      log.error("setMessageReaction", error);
      if (callback) callback(error);
      throw error;
    }
  };
};