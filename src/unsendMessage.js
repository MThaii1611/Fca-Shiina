"use strict";

var utils = require("../utils");
var log = require("npmlog");

module.exports = function(defaultFuncs, api, ctx) {
  return function unsendMessage(messageID, callback, threadID) {
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

    if (utils.getType(messageID) === "Object") {
      threadID = messageID.chatJid || messageID.threadID || threadID;
      messageID = messageID.messageID || messageID.id;
    }

    if (!callback) {
      callback = function(err, data) {
        if (err) return rejectFunc(err);
        resolveFunc(data);
      };
    }

    if (!messageID) {
      var emptyErr = new Error("unsendMessage: messageID is required");
      log.error("unsendMessage", emptyErr.message);
      callback(emptyErr);
      return returnPromise;
    }

    var task = {
      label: utils.LIGHTSPEED_LABELS?.UNSEND_MESSAGE || "33",
      payload: {
        message_id: String(messageID)
      },
      queue_name: "unsend_message",
      task_id: 1,
      failure_count: null
    };

    utils.sendLsTask(ctx, task)
      .then(function() {
        callback(null, { success: true });
        resolveFunc({ success: true });
      })
      .catch(function(err) {
        log.error("unsendMessage", "Lightspeed unsend failed:", err);
        callback(err);
        rejectFunc(err);
      });

    return returnPromise;
  };
};
