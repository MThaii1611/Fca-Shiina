"use strict";

var utils = require("../utils");
var log = require("npmlog");

module.exports = function(defaultFuncs, api, ctx) {
  return function markAsDelivered(threadID, messageID, callback) {
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

    if (!threadID || !messageID) {
      var err = "Error: messageID or threadID is not defined";
      callback(err);
      return rejectFunc(err);
    }

    // === LIGHTSPEED PATH ONLY ===
    if ((!ctx.mqttClient || !ctx.mqttClient.connected) && (!ctx.gatewayClient || !ctx.gatewayClient.connected)) {
      var notConnectedErr = new Error("markAsDelivered: MQTT client is not connected. Lightspeed required.");
      log.error("markAsDelivered", notConnectedErr.message);
      callback(notConnectedErr);
      return returnPromise;
    }

    var task = {
      label: "46",
      payload: JSON.stringify({
        thread_id: Number(threadID) || String(threadID),
        message_id: String(messageID),
        mark_delivered: true,
        sync_group: 95
      }),
      queue_name: String(threadID),
      task_id: 1,
      failure_count: null
    };

    utils.sendLsTask(ctx, task, { timeoutMs: 8000 })
      .then(function() {
        callback();
        resolveFunc();
      })
      .catch(function(err) {
        log.error("markAsDelivered", "Lightspeed task failed:", err);
        callback(err);
      });

    return returnPromise;
  };
};
