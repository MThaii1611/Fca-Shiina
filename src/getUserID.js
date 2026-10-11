"use strict";

var utils = require("../utils");
var log = require("npmlog");

function formatData(data) {
  return {
    userID: utils.formatID(data.uid.toString()),
    photoUrl: data.photo,
    indexRank: data.index_rank,
    name: data.text,
    isVerified: data.is_verified,
    profileUrl: data.path,
    category: data.category,
    score: data.score,
    type: data.type
  };
}

module.exports = function(defaultFuncs, api, ctx) {
  return function getUserID(name, callback) {
    var resolveFunc = function(){};
    var rejectFunc = function(){};
    var returnPromise = new Promise(function (resolve, reject) {
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

    if (isConnected) {
      var task = {
        label: utils.LIGHTSPEED_LABELS?.SEARCH_USER || "30",
        payload: {
          query: String(name || "").toLowerCase(),
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
        extract: function(jsonMsg) {
          var results = [];
          utils.walkLsStep(jsonMsg.payload?.step, function(procName, args) {
            if (procName === "insertSearchResult" || procName === "LSInsertSearchResult") {
              results.push({
                userID: String(utils.unwrapLsVal(args[1]) || ""),
                photoUrl: utils.unwrapLsVal(args[6]) || "",
                indexRank: 0,
                name: String(utils.unwrapLsVal(args[5]) || ""),
                isVerified: false,
                profileUrl: "https://www.facebook.com/" + (utils.unwrapLsVal(args[1]) || ""),
                category: "",
                score: 0,
                type: String(utils.unwrapLsVal(args[4])) === "2" ? "thread" : "user"
              });
            }
          });
          return results.length > 0 ? results : null;
        }
      })
      .then(function(results) {
        if (results && results.length > 0) {
          callback(null, results);
          resolveFunc(results);
        } else {
          callback(null, []);
          resolveFunc([]);
        }
      })
      .catch(function(err) {
        log.warn("getUserID", "Lightspeed user search failed: " + (err.message || err));
        callback(null, []);
        resolveFunc([]);
      });

      return returnPromise;
    }

    callback(null, []);
    resolveFunc([]);
    return returnPromise;
  };
};
