"use strict";

var utils = require("../utils");
var log = require("npmlog");

module.exports = function(defaultFuncs, api, ctx) {
  return function deleteMessage(messageOrMessages, callback, threadID) {
    var resolveFunc = function() {};
    var rejectFunc = function() {};
    var returnPromise = new Promise(function(resolve, reject) {
      resolveFunc = resolve;
      rejectFunc = reject;
    });

    if (utils.getType(callback) === "String" && !threadID) {
      threadID = callback;
      callback = null;
    }

    if (!callback) {
      callback = function(err) {
        if (err) return rejectFunc(err);
        resolveFunc();
      };
    }

    if (utils.getType(messageOrMessages) !== "Array") {
      messageOrMessages = [messageOrMessages];
    }

    const resolvedThreadID = threadID ? (Number(threadID) || String(threadID)) : 0;

    var tasks = messageOrMessages.map(function(msgID, idx) {
      return {
        label: utils.LIGHTSPEED_LABELS?.DELETE_MESSAGE_ME_ONLY || "155",
        payload: {
          thread_key: resolvedThreadID,
          message_id: String(msgID)
        },
        queue_name: "155",
        task_id: idx + 1,
        failure_count: null
      };
    });

    utils.sendLsTasks(ctx, tasks, { timeoutMs: 10000 })
      .then(function() {
        callback(null, { success: true });
        resolveFunc({ success: true });
      })
      .catch(function(err) {
        log.error("deleteMessage", "Lightspeed delete failed:", err);
        callback(err);
        rejectFunc(err);
      });

    return returnPromise;
  };
};
