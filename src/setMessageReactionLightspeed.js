"use strict";

module.exports = function(defaultFuncs, api, ctx) {
  return function setMessageReactionLightspeed(reaction, messageID, callback, forceCustom, threadID) {
    return api.setMessageReaction(reaction, messageID, callback, forceCustom, threadID);
  };
};
