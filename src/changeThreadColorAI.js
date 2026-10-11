"use strict";

const utils = require("../utils");
const log = require("npmlog");

module.exports = function (defaultFuncs, api, ctx) {
  return function changeThreadColorAI(threadID, senderID, options, callback) {
    var resolveFunc = function () {};
    var rejectFunc = function () {};
    var returnPromise = new Promise(function (resolve, reject) {
      resolveFunc = resolve;
      rejectFunc = reject;
    });

    if (typeof options === "function") {
      callback = options;
      options = {};
    }
    options = options || {};

    if (!callback) {
      callback = function (err, res) {
        if (err) return rejectFunc(err);
        resolveFunc(res);
      };
    }

    var prompt = typeof options.prompt === "string" ? options.prompt.trim() : "anime";
    var type = options.type || "prompt";
    var themeID = options.themeID || null;

    (async function () {
      try {
        if (type === "prompt") {
          const genForm = {
            av: ctx.userID,
            __user: ctx.userID,
            fb_dtsg: ctx.fb_dtsg,
            jazoest: ctx.jazoest || ctx.ttstamp || "22",
            lsd: ctx.lsd || ctx.fb_dtsg || "",
            fb_api_caller_class: "RelayModern",
            fb_api_req_friendly_name: "useGenerateAIThemeMutation",
            variables: JSON.stringify({
              input: {
                actor_id: ctx.userID,
                client_mutation_id: Math.round(Math.random() * 19).toString(),
                bypass_cache: true,
                caller: "MESSENGER",
                num_themes: 1,
                prompt: prompt
              }
            }),
            server_timestamps: true,
            doc_id: "23873748445608673",
            fb_api_analytics_tags: ["qpl_active_flow_ids=25309433"]
          };

          log.info("AITheme", `Generating theme for prompt: ${prompt}`);

          const genRes = await defaultFuncs.post(
            "https://www.facebook.com/api/graphql/",
            ctx.jar,
            genForm
          ).then(utils.parseAndCheckLogin(ctx, defaultFuncs));

          const data = genRes?.data?.xfb_generate_ai_themes_from_prompt?.themes?.[0];
          if (!data?.id) throw new Error("Could not extract theme_id from response");

          log.info("AITheme", `Generated theme_id = ${data.id}`);

          var resultData = {
            themeID: String(data.id),
            name: data.accessibility_label || null,
            img: {
              light: data.background_asset?.image?.uri || null,
              dark: data.alternative_themes?.[0]?.background_asset?.image?.uri || null
            }
          };
          callback(null, resultData);
          resolveFunc(resultData);
          return;
        }

        if (type === "apply") {
          if (!themeID) throw new Error("themeID is required for apply type");

          log.info("AITheme", `Applying theme_id ${themeID} to thread ${threadID}`);

          var changeColorMethod = api.changeThreadColor || require("./changeThreadColor")(defaultFuncs, api, ctx);
          await new Promise((resolve, reject) => {
            changeColorMethod(String(themeID), threadID, (err, res) => {
              if (err) return reject(err);
              resolve(res);
            });
          });

          log.info("AITheme", "Applied theme successfully");
          var applyRes = { success: true, themeID: String(themeID) };
          callback(null, applyRes);
          resolveFunc(applyRes);
          return;
        }

        throw new Error("Invalid type parameter: " + type);
      } catch (err) {
        log.error("AITheme", "Error: " + (err.message || err));
        callback(err);
        rejectFunc(err);
      }
    })();

    return returnPromise;
  };
};
