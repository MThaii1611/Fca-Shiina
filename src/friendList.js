"use strict";

const utils = require("../utils");

module.exports = function (defaultFuncs, api, ctx) {
  return function friendList(callback) {
    let resolveFunc = function () {};
    let rejectFunc = function () {};
    const returnPromise = new Promise(function (resolve, reject) {
      resolveFunc = resolve;
      rejectFunc = reject;
    });

    if (!callback) {
      callback = function (err, friendList) {
        if (err) {
          return rejectFunc(err);
        }
        resolveFunc(friendList);
      };
    }

    var isConnected = !!(
      (ctx.mqttClient && ctx.mqttClient.connected) ||
      (ctx.gatewayClient && ctx.gatewayClient.connected)
    );

    if (!isConnected) {
      var errNotConn = new Error("Lightspeed is not connected. Legacy GraphQL disabled to prevent checkpoint.");
      callback(errNotConn);
      rejectFunc(errNotConn);
      return returnPromise;
    }

    var task = {
      label: utils.LIGHTSPEED_LABELS?.GET_CONTACTS_FULL || "207",
      payload: {
        sync_group: 1
      },
      queue_name: "contacts_full",
      task_id: 1,
      failure_count: null
    };

    utils.waitForLsResponse(ctx, utils.buildLsPayload([task]), {
      timeoutMs: 8000,
      extract: function (jsonMsg) {
        var friends = [];
        utils.walkLsStep(jsonMsg.payload?.step, function (procName, args) {
          if (procName === "deleteThenInsertContact" || procName === "LSDeleteThenInsertContact") {
            var cId = utils.unwrapLsVal(args[0]);
            var name = utils.unwrapLsVal(args[7]) || utils.unwrapLsVal(args[8]) || "";
            var img = utils.unwrapLsVal(args[2]) || utils.unwrapLsVal(args[4]) || null;
            if (cId) {
              friends.push({
                userID: String(cId),
                name: String(name),
                shortName: String(name.split(' ').pop() || ""),
                gender: null,
                profilePicture: img ? String(img) : null,
                profileUrl: "https://www.facebook.com/" + cId,
                friendshipStatus: "ARE_FRIENDS",
                socialContext: "",
                isSecureThread: false,
                subscribeStatus: null
              });
            }
          }
        });
        return friends.length > 0 ? { totalCount: friends.length, friendCount: friends.length, friends: friends } : null;
      }
    })
    .then(function (result) {
      var res = result || { totalCount: 0, friendCount: 0, friends: [] };
      callback(null, res);
      resolveFunc(res);
    })
    .catch(function (err) {
      var emptyRes = { totalCount: 0, friendCount: 0, friends: [] };
      callback(null, emptyRes);
      resolveFunc(emptyRes);
    });

    return returnPromise;
  };
};
