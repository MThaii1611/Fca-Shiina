"use strict";

var utils = require("../utils");
var log = require("npmlog");

module.exports = function(defaultFuncs, api, ctx) {
  return function markAsReadAll(callback) {
    var resolveFunc = function() {};
    var rejectFunc = function() {};
    var returnPromise = new Promise(function(resolve, reject) {
      resolveFunc = resolve;
      rejectFunc = reject;
    });

    if (!callback) {
      callback = function(err) {
        if (err) return rejectFunc(err);
        resolveFunc();
      };
    }

    // === LIGHTSPEED PATH ONLY ===
    if ((!ctx.mqttClient || !ctx.mqttClient.connected) && (!ctx.gatewayClient || !ctx.gatewayClient.connected)) {
      var notConnectedErr = new Error("markAsReadAll: MQTT client is not connected. Lightspeed required.");
      log.error("markAsReadAll", notConnectedErr.message);
      callback(notConnectedErr);
      return returnPromise;
    }

    var tasks = [
      {
        label: "21",
        payload: JSON.stringify({
          thread_id: 0, // 0 = all inbox threads
          last_read_watermark_ts: Date.now(),
          sync_group: 95,
          offline_threading_id: null
        }),
        queue_name: "inbox",
        task_id: 1,
        failure_count: null
      }
    ];

    utils.sendLsTasks(ctx, tasks, { timeoutMs: 10000 })
      .then(function() {
        callback();
        resolveFunc();
      })
      .catch(function(err) {
        log.error("markAsReadAll", "Lightspeed task failed:", err);
        callback(err);
      });

    return returnPromise;
  };
};
