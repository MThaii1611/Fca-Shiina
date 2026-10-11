"use strict";

var utils = require("../utils");
var log = require("npmlog");

module.exports = function(defaultFuncs, api, ctx) {
  return function changeArchivedStatus(threadOrThreads, archive, callback) {
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

    var isConnected = !!(
      (ctx.mqttClient && ctx.mqttClient.connected) ||
      (ctx.gatewayClient && ctx.gatewayClient.connected)
    );

    if (!isConnected) {
      var errNotConn = new Error("Lightspeed is not connected. Legacy HTTP disabled to prevent checkpoint.");
      callback(errNotConn);
      rejectFunc(errNotConn);
      return returnPromise;
    }

    var tasks = threadOrThreads.map(function(threadID, idx) {
      return {
        label: utils.LIGHTSPEED_LABELS?.MUTE_THREAD || "144",
        payload: {
          thread_key: Number(threadID) || String(threadID),
          sync_group: 1,
          is_archived: !!archive
        },
        queue_name: String(threadID),
        task_id: idx + 1,
        failure_count: null
      };
    });

    utils.sendLsTasks(ctx, tasks, { timeoutMs: 10000 })
      .then(function() {
        var res = { success: true, archived: !!archive };
        callback(null, res);
        resolveFunc(res);
      })
      .catch(function(err) {
        log.error("changeArchivedStatus", "Lightspeed task error: " + (err.message || err));
        callback(err);
        rejectFunc(err);
      });

    return returnPromise;
  };
};
