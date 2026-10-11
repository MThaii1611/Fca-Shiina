"use strict";

var utils = require("../utils");
var log = require("npmlog");

module.exports = function(defaultFuncs, api, ctx) {
  return function handleMessageRequest(threadID, accept, callback) {
    if (utils.getType(accept) !== "Boolean") {
      throw {
        error: "Please pass a boolean as a second argument."
      };
    }

    var resolveFunc = function(){};
    var rejectFunc = function(){};
    var returnPromise = new Promise(function (resolve, reject) {
      resolveFunc = resolve;
      rejectFunc = reject;
    });

    if (!callback) {
      callback = function (err, data) {
        if (err) {
          return rejectFunc(err);
        }
        resolveFunc(data);
      };
    }

    if (utils.getType(threadID) !== "Array") {
      threadID = [threadID];
    }

    var tasks = threadID.map(function(id, idx) {
      if (accept) {
        return {
          label: utils.LIGHTSPEED_LABELS?.ACCEPT_MESSAGE_REQUEST || "66",
          payload: {
            thread_key: Number(id) || String(id),
            sync_group: 1,
            ig_folder: null
          },
          queue_name: "message_request",
          task_id: idx + 1,
          failure_count: null
        };
      } else {
        return {
          label: utils.LIGHTSPEED_LABELS?.DELETE_THREAD || "146",
          payload: {
            thread_key: Number(id) || String(id),
            remove_type: 1,
            sync_group: 1
          },
          queue_name: String(id),
          task_id: idx + 1,
          failure_count: null
        };
      }
    });

    utils.sendLsTasks(ctx, tasks, { timeoutMs: 10000 })
      .then(function() {
        callback(null, { success: true });
        resolveFunc({ success: true });
      })
      .catch(function(err) {
        log.error("handleMessageRequest", "Lightspeed handleMessageRequest failed:", err);
        callback(err);
        rejectFunc(err);
      });

    return returnPromise;
  };
};