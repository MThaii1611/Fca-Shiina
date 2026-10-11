"use strict";

var utils = require("../utils");
var log = require("npmlog");

module.exports = function(defaultFuncs, api, ctx) {
  return function createPoll(title, threadID, options, callback) {
    var resolveFunc = function(){};
    var rejectFunc = function(){};
    var returnPromise = new Promise(function (resolve, reject) {
      resolveFunc = resolve;
      rejectFunc = reject;
    });

    if (!callback) {
      if (utils.getType(options) == "Function") {
        callback = options;
        options = null;
      } else {
        callback = function(err, data) {
          if (err) {
            return rejectFunc(err);
          }
          resolveFunc(data);
        };
      }
    }

    if (!options) {
      options = [];
    }

    var optArray = [];
    if (Array.isArray(options)) {
      optArray = options;
    } else if (typeof options === "object" && options !== null) {
      optArray = Object.keys(options);
    }

    var task = {
      label: utils.LIGHTSPEED_LABELS?.CREATE_POLL || "163",
      payload: {
        question_text: String(title),
        thread_key: Number(threadID) || String(threadID),
        options: optArray,
        sync_group: 1
      },
      queue_name: "poll_creation",
      task_id: 1,
      failure_count: null
    };

    utils.sendLsTask(ctx, task)
      .then(function() {
        callback(null, { success: true });
        resolveFunc({ success: true });
      })
      .catch(function(err) {
        log.error("createPoll", "Lightspeed create poll failed:", err);
        callback(err);
        rejectFunc(err);
      });

    return returnPromise;
  };
};
