"use strict";

var utils = require("../utils");
var log = require("npmlog");

module.exports = function(defaultFuncs, api, ctx) {
  function pinMessage(messageID, threadID, pin = true, callback) {
    var resolveFunc = function(){};
    var rejectFunc = function(){};
    var returnPromise = new Promise(function (resolve, reject) {
      resolveFunc = resolve;
      rejectFunc = reject;
    });

    if (typeof pin === "function") {
      callback = pin;
      pin = true;
    }

    if (!callback) {
      callback = function(err, data) {
        if (err) return rejectFunc(err);
        resolveFunc(data);
      };
    }

    if (!messageID) {
      var errEmpty = new Error("pinMessage: messageID is required");
      log.error("pinMessage", errEmpty.message);
      callback(errEmpty);
      return returnPromise;
    }

    if (!threadID && ctx.messageToThread) {
      if (typeof ctx.messageToThread.get === "function") {
        threadID = ctx.messageToThread.get(String(messageID));
      } else {
        threadID = ctx.messageToThread[String(messageID)];
      }
    }

    var task = {
      label: pin ? (utils.LIGHTSPEED_LABELS?.PIN_MESSAGE || "430") : (utils.LIGHTSPEED_LABELS?.UNPIN_MESSAGE || "431"),
      payload: {
        thread_key: Number(threadID) || String(threadID || 0),
        message_id: String(messageID)
      },
      queue_name: String(threadID || "pin_message"),
      task_id: 1,
      failure_count: null
    };

    utils.sendLsTask(ctx, task)
      .then(function() {
        var res = { success: true, pinned: !!pin };
        callback(null, res);
        resolveFunc(res);
      })
      .catch(function(err) {
        log.error("pinMessage", "Lightspeed pinMessage failed:", err);
        callback(err);
        rejectFunc(err);
      });

    return returnPromise;
  }

  api.unpinMessage = function(messageID, threadID, callback) {
    return pinMessage(messageID, threadID, false, callback);
  };

  return pinMessage;
};
