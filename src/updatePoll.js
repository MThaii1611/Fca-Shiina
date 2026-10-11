"use strict";

var utils = require("../utils");
var log = require("npmlog");

module.exports = function(defaultFuncs, api, ctx) {
  return function updatePoll(threadID, pollID, selectedOptions, callback) {
    var resolveFunc = function(){};
    var rejectFunc = function(){};
    var returnPromise = new Promise(function (resolve, reject) {
      resolveFunc = resolve;
      rejectFunc = reject;
    });

    if (!callback) {
      callback = function(err, data) {
        if (err) return rejectFunc(err);
        resolveFunc(data);
      };
    }

    if (!selectedOptions) selectedOptions = [];
    if (!Array.isArray(selectedOptions)) selectedOptions = [selectedOptions];

    var task = {
      label: utils.LIGHTSPEED_LABELS?.UPDATE_POLL || "164",
      payload: {
        thread_key: Number(threadID) || String(threadID),
        poll_id: Number(pollID) || String(pollID),
        added_options: [],
        selected_options: selectedOptions.map(Number),
        sync_group: 1
      },
      queue_name: "poll_update",
      task_id: 1,
      failure_count: null
    };

    utils.sendLsTask(ctx, task)
      .then(function() {
        var res = { success: true };
        callback(null, res);
        resolveFunc(res);
      })
      .catch(function(err) {
        log.error("updatePoll", "Lightspeed updatePoll failed:", err);
        callback(err);
        rejectFunc(err);
      });

    return returnPromise;
  };
};
