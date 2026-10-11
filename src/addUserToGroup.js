"use strict";

var utils = require("../utils");
var log = require("npmlog");

module.exports = function(defaultFuncs, api, ctx) {
  return function addUserToGroup(userID, threadID, callback) {
    var resolveFunc = function(){};
    var rejectFunc = function(){};
    var returnPromise = new Promise(function (resolve, reject) {
      resolveFunc = resolve;
      rejectFunc = reject;
    });

    if (
      !callback &&
      (utils.getType(threadID) === "Function" ||
        utils.getType(threadID) === "AsyncFunction")
    ) {
      throw { error: "please pass a threadID as a second argument." };
    }

    if (!callback) {
      callback = function(err) {
        if (err) {
          return rejectFunc(err);
        }
        resolveFunc();
      };
    }

    if (
      utils.getType(threadID) !== "Number" &&
      utils.getType(threadID) !== "String"
    ) {
      throw {
        error:
          "ThreadID should be of type Number or String and not " +
          utils.getType(threadID) +
          "."
      };
    }

    if (utils.getType(userID) !== "Array") {
      userID = [userID];
    }

    var userIdsMapped = [];
    for (var i = 0; i < userID.length; i++) {
      if (
        utils.getType(userID[i]) !== "Number" &&
        utils.getType(userID[i]) !== "String"
      ) {
        throw {
          error:
            "Elements of userID should be of type Number or String and not " +
            utils.getType(userID[i]) +
            "."
        };
      }
      userIdsMapped.push(Number(userID[i]));
    }

    var cleanThreadID = String(threadID).trim();
    var userIds = [];
    var userIdsMapped = [];
    for (var i = 0; i < userID.length; i++) {
      var uidStr = String(userID[i]).trim();
      userIds.push(uidStr);
      var numVal = Number(uidStr);
      if (Number.isSafeInteger(numVal)) {
        userIdsMapped.push(numVal);
      } else {
        userIdsMapped.push(uidStr);
      }
    }

    var isConnected = !!(
      (ctx.mqttClient && ctx.mqttClient.connected) ||
      (ctx.gatewayClient && ctx.gatewayClient.connected)
    );

    if (isConnected) {
      var task = {
        label: utils.LIGHTSPEED_LABELS?.ADD_PARTICIPANTS || "23",
        payload: {
          thread_key: Number.isSafeInteger(Number(cleanThreadID)) ? Number(cleanThreadID) : cleanThreadID,
          contact_ids: userIdsMapped,
          sync_group: 1
        },
        queue_name: cleanThreadID,
        task_id: 1,
        failure_count: null
      };

      utils.sendLsTask(ctx, task, { noWaitAck: true }).catch(function() {});
      var resSuccess = { success: true, method: "lightspeed" };
      callback(null, resSuccess);
      resolveFunc(resSuccess);
      return returnPromise;
    }

    var errNotConn = { error: "addUserToGroup: MQTT/Gateway is not connected" };
    callback(errNotConn);
    rejectFunc(errNotConn);
    return returnPromise;
  };
};
