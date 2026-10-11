"use strict";

var utils = require("../utils");
var log = require("npmlog");

function safeGetFrom(str, start, end) {
  try { return utils.getFrom(str, start, end); } catch (_) { return ""; }
}

function buildLogoutForm(resData, ctx) {
  var jsmods = resData && resData.jsmods ? resData.jsmods : {};

  if (Array.isArray(jsmods.instances) && jsmods.instances[0] && jsmods.instances[0][2] &&
      jsmods.instances[0][2][0] && Array.isArray(jsmods.instances[0][2][0]) && Array.isArray(jsmods.markup)) {
    var elem = jsmods.instances[0][2][0].filter(function(v) { return v && v.value === "logout"; })[0];
    if (elem && elem.markup && elem.markup.__m) {
      var found = jsmods.markup.filter(function(v) { return v && v[0] === elem.markup.__m; })[0];
      var html = found && found[1] ? found[1].__html : "";
      if (html) return {
        fb_dtsg: safeGetFrom(html, '"fb_dtsg" value="', '"') || ctx.fb_dtsg || "",
        ref: safeGetFrom(html, '"ref" value="', '"'),
        h: safeGetFrom(html, '"h" value="', '"')
      };
    }
  }

  var markupList = Array.isArray(jsmods.markup) ? jsmods.markup : [];
  for (var i = 0; i < markupList.length; i++) {
    var htmlCandidate = markupList[i] && markupList[i][1] ? markupList[i][1].__html : "";
    if (!htmlCandidate || htmlCandidate.indexOf("logout.php") === -1) continue;
    var fbDtsg = safeGetFrom(htmlCandidate, '"fb_dtsg" value="', '"') || ctx.fb_dtsg || "";
    if (fbDtsg) return {
      fb_dtsg: fbDtsg,
      ref: safeGetFrom(htmlCandidate, '"ref" value="', '"'),
      h: safeGetFrom(htmlCandidate, '"h" value="', '"')
    };
  }

  return { fb_dtsg: ctx.fb_dtsg || "", ref: "", h: "" };
}

module.exports = function(defaultFuncs, api, ctx) {
  return function logout(callback) {
    var resolveFunc = function() {}, rejectFunc = function() {};
    var returnPromise = new Promise(function(resolve, reject) { resolveFunc = resolve; rejectFunc = reject; });
    if (!callback) {
      callback = function(err, data) {
        if (err) return rejectFunc(err);
        resolveFunc(data);
      };
    }

    defaultFuncs
      .post("https://www.facebook.com/bluebar/modern_settings_menu/?help_type=364455653583099&show_contextual_help=1", ctx.jar, { pmid: "0" })
      .then(utils.parseAndCheckLogin(ctx, defaultFuncs))
      .then(function(resData) {
        var logoutForm = buildLogoutForm(resData, ctx);
        return defaultFuncs.post("https://www.facebook.com/logout.php", ctx.jar, logoutForm).then(utils.saveCookies(ctx.jar));
      })
      .then(function(res) {
        if (res && res.headers && res.headers.location)
          return defaultFuncs.get(res.headers.location, ctx.jar).then(utils.saveCookies(ctx.jar));
        return res;
      })
      .then(function() {
        if (ctx.refreshDtsgTimer) { clearInterval(ctx.refreshDtsgTimer); ctx.refreshDtsgTimer = null; }
        ctx.loggedIn = false;
        log.info("logout", "Logged out successfully.");
        callback();
      })
      .catch(function(err) { log.error("logout", err); return callback(err); });

    return returnPromise;
  };
};
