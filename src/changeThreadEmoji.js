"use strict";

var utils = require("../utils");
var log = require("npmlog");

module.exports = function(defaultFuncs, api, ctx) {
  return function changeThreadEmoji(emoji, threadID, callback) {
    var resolveFunc = function(){};
    var rejectFunc = function(){};
    var returnPromise = new Promise(function (resolve, reject) {
      resolveFunc = resolve;
      rejectFunc = reject;
    });

    if (!callback) {
      callback = function(err) {
        if (err) {
          return rejectFunc(err);
        }
        resolveFunc();
      };
    }

    if ((!ctx.mqttClient || !ctx.mqttClient.connected) && (!ctx.gatewayClient || !ctx.gatewayClient.connected)) {
      var notConnectedErr = new Error("changeThreadEmoji: MQTT client is not connected. Lightspeed required.");
      log.error("changeThreadEmoji", notConnectedErr.message);
      callback(notConnectedErr);
      return returnPromise;
    }

    var task = {
      label: utils.LIGHTSPEED_LABELS?.SET_QUICK_EMOJI || "100003",
      payload: {
        thread_key: Number(threadID) || String(threadID),
        custom_emoji: emoji || "👍",
        avatar_sticker_instruction_key_id: null,
        sync_group: 1,
        offline_threading_id: null
      },
      queue_name: "thread_quick_reaction",
      task_id: 1,
      failure_count: null
    };

    utils.sendLsTask(ctx, task)
      .then(function() {
        return callback();
      })
      .catch(function(err) {
        log.error("changeThreadEmoji", "Lightspeed task failed:", err);
        return callback(err);
      });

    return returnPromise;
  };
};
