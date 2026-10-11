"use strict";

var utils = require("../utils");
var log = require("npmlog");

module.exports = function (defaultFuncs, api, ctx) {
  function makeTypingIndicator(typ, threadID, callback, isGroup) {
    // === LIGHTSPEED PATH ===
    if ((ctx.mqttClient && ctx.mqttClient.connected) || (ctx.gatewayClient && ctx.gatewayClient.connected)) {
      var task = {
        label: utils.LIGHTSPEED_LABELS?.SET_TYPING_INDICATOR || "18",
        payload: {
          thread_key: Number(threadID) || String(threadID),
          is_typing: !!typ,
          sync_group: 95
        },
        queue_name: String(threadID),
        task_id: 1,
        failure_count: null
      };

      utils.sendLsTask(ctx, task, { timeoutMs: 5000 })
        .then(function() {
          callback();
        })
        .catch(function(err) {
          log.warn("sendTypingIndicator", "Lightspeed task 18 error: " + (err.message || err));
          callback();
        });
      return;
    }

    // Nếu MQTT chưa sẵn sàng, no-op an toàn thay vì gọi HTTP cũ (tránh checkpoint)
    callback();
  }

  return function sendTypingIndicator(threadID, callback, isGroup) {
    if (
      utils.getType(callback) !== "Function" &&
      utils.getType(callback) !== "AsyncFunction"
    ) {
      if (callback) log.warn("sendTypingIndicator", "callback is not a function - ignoring.");
      callback = () => { };
    }

    makeTypingIndicator(true, threadID, callback, isGroup);

    return function end(cb) {
      if (
        utils.getType(cb) !== "Function" &&
        utils.getType(cb) !== "AsyncFunction"
      ) {
        if (cb) log.warn("sendTypingIndicator", "callback is not a function - ignoring.");
        cb = () => { };
      }

      makeTypingIndicator(false, threadID, cb, isGroup);
    };
  };
};
