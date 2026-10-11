"use strict";

var utils = require("../utils");
var log = require("npmlog");

module.exports = function (defaultFuncs, api, ctx) {
  return function setMessageReactionMqtt(reaction, messageID, threadID, callback) {
    if (typeof threadID === "function") {
      callback = threadID;
      threadID = null;
    }
    return api.setMessageReaction(reaction, messageID, callback, false, threadID);
  };
};
