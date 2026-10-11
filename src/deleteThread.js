"use strict";

var utils = require("../utils");
var log = require("npmlog");

module.exports = function(defaultFuncs, api, ctx) {
  return function deleteThread(threadOrThreads, callback) {
    var resolveFunc = function(){};
    var rejectFunc = function(){};
    var returnPromise = new Promise(function (resolve, reject) {
      resolveFunc = resolve;
      rejectFunc = reject;
    });

    if (!callback) {
      callback = function(err, data) {
        if (err) {
          return rejectFunc(err);
        }
        resolveFunc(data);
      };
    }

    if (utils.getType(threadOrThreads) !== "Array") {
      threadOrThreads = [threadOrThreads];
    }

    var tasks = threadOrThreads.map(function(threadID, idx) {
      return {
        label: utils.LIGHTSPEED_LABELS?.DELETE_THREAD || "146",
        payload: {
          thread_key: Number(threadID) || String(threadID),
          remove_type: 1,
          sync_group: 1
        },
        queue_name: String(threadID),
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
        log.error("deleteThread", "Lightspeed delete thread failed:", err);
        callback(err);
        rejectFunc(err);
      });

    return returnPromise;
  };
};
