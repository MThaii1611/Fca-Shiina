"use strict";

module.exports = function (defaultFuncs, api, ctx) {
  return function setThreadTheme(threadID, themeFBID, callback) {
    if (!api.changeThreadColor) {
      var changeThreadColor = require("./changeThreadColor")(defaultFuncs, api, ctx);
      return changeThreadColor(themeFBID, threadID, callback);
    }
    return api.changeThreadColor(themeFBID, threadID, callback);
  };
};
