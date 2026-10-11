"use strict";

var utils = require("../utils");
var log = require("npmlog");

module.exports = function(defaultFuncs, api, ctx) {
  return function changeNickname(nickname, threadID, participantID, callback) {
    var resolveFunc = function(){};
    var rejectFunc = function(){};
    var returnPromise = new Promise(function (resolve, reject) {
      resolveFunc = resolve;
      rejectFunc = reject;
    });
    if (!callback) {
      callback = function (err) {
        if (err) {
          return rejectFunc(err);
        }
        resolveFunc();
      };
    }

    var otid = utils.generateOfflineThreadingID ? utils.generateOfflineThreadingID() : (BigInt(Date.now()) << 22n).toString();
    var cleanNickname = String(nickname != null ? nickname : "");

    // 1. Lightspeed MQTT Task 44
    var isConnected = !!(
      (ctx.mqttClient && ctx.mqttClient.connected) ||
      (ctx.gatewayClient && ctx.gatewayClient.connected)
    );

    var task = {
      label: utils.LIGHTSPEED_LABELS?.SET_NICKNAME || "44",
      payload: {
        thread_key: Number(threadID) || String(threadID),
        thread_id: String(threadID),
        contact_id: Number(participantID) || String(participantID),
        participant_id: Number(participantID) || String(participantID),
        nickname: cleanNickname,
        custom_nickname: cleanNickname,
        sync_group: 1,
        offline_threading_id: otid
      },
      queue_name: "thread_participant_nickname",
      task_id: 1,
      failure_count: null
    };

    var form = {
      nickname: cleanNickname,
      participant_id: String(participantID),
      thread_or_other_fbid: String(threadID)
    };

    var settled = false;
    function settleSuccess() {
      if (!settled) {
        settled = true;
        callback(null, { success: true });
        resolveFunc({ success: true });
      }
    }

    function settleError(err) {
      if (!settled) {
        settled = true;
        log.error("changeNickname", err);
        callback(err);
        rejectFunc(err);
      }
    }

    if (isConnected) {
      utils.sendLsTask(ctx, task, { noWaitAck: true }).catch(function() {});
      settleSuccess();
    } else {
      settleError(new Error("Not connected to MQTT/Gateway"));
    }

    return returnPromise;
  };
};
