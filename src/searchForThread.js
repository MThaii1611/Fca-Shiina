"use strict";

var utils = require("../utils");
var log = require("npmlog");

module.exports = function(defaultFuncs, api, ctx) {
  return function searchForThread(name, callback) {
    var resolveFunc = function(){};
    var rejectFunc = function(){};
    var returnPromise = new Promise(function (resolve, reject) {
      resolveFunc = resolve;
      rejectFunc = reject;
    });

    if (!callback) {
      callback = function (err, results) {
        if (err) {
          return rejectFunc(err);
        }
        resolveFunc(results);
      };
    }

    if (!name || typeof name !== "string") {
      var errEmpty = new Error("searchForThread: search query name is required");
      log.error("searchForThread", errEmpty.message);
      callback(errEmpty);
      return returnPromise;
    }

    var task = {
      label: utils.LIGHTSPEED_LABELS?.SEARCH_USER || "30",
      payload: {
        query: String(name),
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

    var content = utils.buildLsPayload([task]);

    utils.waitForLsResponse(ctx, content, {
      timeoutMs: 10000,
      extract: function(jsonMsg) {
        var results = [];
        utils.walkLsStep(jsonMsg.payload?.step, function(procName, args) {
          if (procName === "insertSearchResult") {
            results.push({
              threadID: String(utils.unwrapLsVal(args[1]) || ""),
              name: String(utils.unwrapLsVal(args[5]) || ""),
              image_src: utils.unwrapLsVal(args[6]) || null,
              snippet: utils.unwrapLsVal(args[8]) || "",
              isGroup: String(utils.unwrapLsVal(args[4])) === "2"
            });
          }
        });
        return results;
      }
    })
    .then(function(results) {
      callback(null, results);
      resolveFunc(results);
    })
    .catch(function(err) {
      log.error("searchForThread", "Lightspeed search failed:", err);
      callback(err);
      rejectFunc(err);
    });

    return returnPromise;
  };
};
