"use strict";

var utils = require("../utils");
var log = require("npmlog");

module.exports = function(defaultFuncs, api, ctx) {
  return function muteThread(threadID, muteSeconds, callback) {
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

    // muteSeconds: -1 = mute vinh vien, 0 = unmute, 60 = 1 phut, 3600 = 1 gio
    var label = muteSeconds === 0 ? "177" : "176"; // 176=mute, 177=unmute
    var syncGroup = muteSeconds === 0 ? 1 : 1;

    // === LIGHTSPEED PATH ===
    if (ctx.mqttClient && ctx.mqttClient.connected) {
      var task = {
        label: label,
        payload: JSON.stringify({
          thread_key: Number(threadID) || String(threadID),
          mute_duration: muteSeconds,
          sync_group: syncGroup
        }),
        queue_name: String(threadID),
        task_id: 1,
        failure_count: null
      };

      utils.sendLsTask(ctx, task, { timeoutMs: 10000 })
        .then(function() {
          callback();
          resolveFunc();
        })
        .catch(function(err) {
          log.warn("muteThread Lightspeed failed:", err.message || err);
          callback(err);
          rejectFunc(err);
        });

      return returnPromise;
    }

    callback();
    resolveFunc();

    return returnPromise;
  };
};
