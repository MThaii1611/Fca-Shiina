"use strict";

const utils = require("../utils");

module.exports = function (defaultFuncs, api, ctx) {
  return function searchFriends(searchQuery, callback) {
    let resolveFunc = function () {};
    let rejectFunc = function () {};
    const returnPromise = new Promise(function (resolve, reject) {
      resolveFunc = resolve;
      rejectFunc = reject;
    });

    if (!callback) {
      callback = function (err, result) {
        if (err) {
          return rejectFunc(err);
        }
        resolveFunc(result);
      };
    }

    if (!searchQuery || searchQuery.trim().length === 0) {
      var errEmpty = new Error("Search query cannot be empty");
      callback(errEmpty);
      return rejectFunc(errEmpty);
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
      label: utils.LIGHTSPEED_LABELS?.SEARCH_USER || "30",
      payload: {
        query: String(searchQuery).trim(),
        supported_types: [1, 2, 3, 4, 6, 7, 8, 9, 13],
        session_id: null,
        surface_type: 5,
        selected_participants: null,
        group_id: null,
        community_id: null,
        query_id: null
      },
      queue_name: JSON.stringify(["search_primary", Date.now()]),
      task_id: 1,
      failure_count: null
    };

    utils.waitForLsResponse(ctx, utils.buildLsPayload([task]), {
      timeoutMs: 8000,
      extract: function (jsonMsg) {
        var results = [];
        utils.walkLsStep(jsonMsg.payload?.step, function (procName, args) {
          if (procName === "insertSearchResult" || procName === "LSInsertSearchResult") {
            results.push({
              userID: String(utils.unwrapLsVal(args[1]) || ""),
              name: String(utils.unwrapLsVal(args[5]) || ""),
              profilePicture: utils.unwrapLsVal(args[6]) || null,
              profileUrl: "https://www.facebook.com/" + (utils.unwrapLsVal(args[1]) || ""),
              subtitle: utils.unwrapLsVal(args[8]) || "",
              mutualFriends: 0,
              isGroup: String(utils.unwrapLsVal(args[4])) === "2"
            });
          }
        });
        return results;
      }
    })
    .then(function (results) {
      var res = results || [];
      callback(null, res);
      resolveFunc(res);
    })
    .catch(function (err) {
      callback(null, []);
      resolveFunc([]);
    });

    return returnPromise;
  };
};
