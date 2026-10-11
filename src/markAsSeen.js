"use strict";

var utils = require("../utils");
var log = require("npmlog");

module.exports = function (defaultFuncs, api, ctx) {
  return function markAsRead(seen_timestamp, callback, threadID) {
    if (utils.getType(seen_timestamp) === "Function" || utils.getType(seen_timestamp) === "AsyncFunction") {
      callback = seen_timestamp;
      seen_timestamp = Date.now();
    }

    if (utils.getType(callback) === "String" || utils.getType(callback) === "Number") {
      threadID = callback;
      callback = null;
    }

    var resolveFunc = function () { };
    var rejectFunc = function () { };
    var returnPromise = new Promise(function (resolve, reject) {
      resolveFunc = resolve;
      rejectFunc = reject;
    });

    if (!callback) {
      callback = function (err) {
        if (err) return rejectFunc(err);
        resolveFunc();
      };
    }

    var isConnected = !!(
      (ctx.mqttClient && ctx.mqttClient.connected) ||
      (ctx.gatewayClient && ctx.gatewayClient.connected)
    );

    if (isConnected) {
      var resolvedThreadID = threadID ? (Number(threadID) || String(threadID)) : 0;
      var task = {
        label: utils.LIGHTSPEED_LABELS?.MARK_READ || "21",
        payload: JSON.stringify({
          thread_id: resolvedThreadID,
          last_read_watermark_ts: Number(seen_timestamp) || Date.now(),
          sync_group: 95,
          offline_threading_id: null
        }),
        queue_name: resolvedThreadID ? String(resolvedThreadID) : "inbox",
        task_id: 1,
        failure_count: null
      };

      utils.sendLsTask(ctx, task, { timeoutMs: 8000 })
        .then(function () {
          callback(null, { success: true });
          resolveFunc({ success: true });
        })
        .catch(function (err) {
          log.warn("markAsSeen", "Lightspeed task 21 error: " + (err.message || err));
          // fallback over MQTT topic without hitting HTTP
          if (ctx.mqttClient && ctx.mqttClient.connected) {
            ctx.mqttClient.publish("/mark_thread", JSON.stringify({
              threadID: resolvedThreadID,
              mark: "read",
              state: true
            }), { qos: 1, retain: false }, () => {});
          }
          callback(null, { success: true });
          resolveFunc({ success: true });
        });
      return returnPromise;
    }

    callback(null, { success: true });
    resolveFunc({ success: true });
    return returnPromise;
  };
};
