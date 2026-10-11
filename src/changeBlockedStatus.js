"use strict";

var utils = require("../utils");
var log = require("npmlog");

module.exports = function (defaultFuncs, api, ctx) {
  return function changeBlockedStatus(userID, block, type, callback) {
    if (typeof type === "function") {
      callback = type;
      type = "messenger";
    }
    type = type || "messenger";

    var resolveFunc = function () { };
    var rejectFunc = function () { };
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

    var isConnected = !!(
      (ctx.mqttClient && ctx.mqttClient.connected) ||
      (ctx.gatewayClient && ctx.gatewayClient.connected)
    );

    if (!isConnected) {
      var errConn = { error: "changeBlockedStatus: Neither MQTT nor Gateway is connected" };
      callback(errConn);
      return returnPromise;
    }

    var userBlockAction;
    if (type === "messenger") {
      userBlockAction = block ? 1 : 0;
    } else if (type === "facebook") {
      userBlockAction = block ? 3 : 2;
    } else {
      var errType = { error: "changeBlockedStatus: type phai la 'messenger' hoac 'facebook'" };
      callback(errType);
      return returnPromise;
    }

    var task = {
      label: "334",
      payload: {
        blockee_id: userID,
        request_id: utils.getGUID(),
        user_block_action: userBlockAction
      },
      queue_name: "native_sync_block",
      failure_count: null
    };

    utils.sendLsTask(ctx, task)
      .then(function () {
        var result = { success: true, blocked: !!block, type: type };
        callback(null, result);
        resolveFunc(result);
      })
      .catch(function (err) {
        log.error("changeBlockedStatus", err);
        callback(err);
        rejectFunc(err);
      });

    return returnPromise;
  };
};
