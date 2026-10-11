"use strict";

var utils = require("../utils");
var log = require("npmlog");

module.exports = function(defaultFuncs, api, ctx) {
  function makeTypingIndicator(typ, threadID, callback, isGroup) {
    // === LIGHTSPEED PATH ===
    if (ctx.mqttClient && ctx.mqttClient.connected) {
      var task = {
        label: "18",
        payload: JSON.stringify({
          thread_key: Number(threadID) || String(threadID),
          is_typing: !!typ,
          sync_group: 95
        }),
        queue_name: String(threadID),
        task_id: 1,
        failure_count: null
      };

      utils.sendLsTask(ctx, task, { timeoutMs: 5000 })
        .then(function() {
          callback();
        })
        .catch(function(err) {
          log.warn("sendTyping Lightspeed failed:", err.message || err);
          callback();
        });
      return;
    }

    callback();
  }

  return function sendTypingIndicator(threadID, callback, isGroup) {
    if (typeof callback !== "function" && typeof callback !== "asyncfunction") {
      callback = function() {};
    }

    makeTypingIndicator(true, threadID, callback, isGroup);

    return function end(cb) {
      if (typeof cb !== "function") cb = function() {};
      makeTypingIndicator(false, threadID, cb, isGroup);
    };
  };
};
