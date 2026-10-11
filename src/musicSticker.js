"use strict";

const request = require("request");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const utils = require("../utils");

const GRAPHQL_URL = "https://graph.facebook.com/graphql";
const PRODUCT_STICKER = "MSGR_DIRECT_MUSIC_STICKER";
const DEFAULT_ORCA_UA =
  "Dalvik/2.1.0 (Linux; U; Android 9; 23113RKC6C Build/PQ3A.190605.06171036) [FBAN/Orca-Android;FBAV/536.0.0.46.216;FBPN/com.facebook.orca;FBLC/vi_VN;FBBV/840054738;FBCR/MobiFone;FBMF/Redmi;FBBD/Redmi;FBDV/23113RKC6C;FBSV/9;FBCA/x86_64:arm64-v8a;FBDM/{density=3.0,width=1080,height=1920};FB_FW/1;]";
const DEFAULT_X_ZERO_EH = "2,,";
const APP_ID_POOL = ["772021112871879", "2220391788200892"];
const VERSION_POOL = [
  "25150404991310813",
  "32181477484799631",
  "9723306621127838",
  "24728819436812368",
  "24804310205905615",
  "31104338375848389"
];

function pick(items) {
  return items[(Math.random() * items.length) | 0];
}

function trace() {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let out = "#";
  for (let i = 0; i < 22; i++) out += chars[(Math.random() * chars.length) | 0];
  return out;
}

function toNum(value) {
  const str = String(value);
  if (/^\d+$/.test(str)) {
    const num = Number(str);
    if (Number.isSafeInteger(num)) return num;
  }
  return str;
}

function buildNavigationChain() {
  const now = Date.now() / 1000;
  const safe = (ts) => Math.max(ts, 0).toFixed(3);
  const sessionId = 20000000 + Math.floor(Math.random() * 10000000);
  return `MusicPickerBottomSheetFragment,dialog,,${safe(now)},${sessionId},,,${safe(now)};,e2ee_keyboard_popup,tap_composer_list_item,${safe(now - 0.1)},,,,,${safe(now - 0.1)};,thread_open:group,tap_conversation_thread,${safe(now - 0.01)},,,,,${safe(now)};MainActivity,tab_INBOX,foreground,${safe(now - 1)},${sessionId},,,,,${safe(now - 1)}`;
}

function mqttReady(ctx) {
  const client = ctx && ctx.mqttClient;
  return !!(client && client.connected && !client.reconnecting && !client.disconnecting && !client.disconnected);
}

function parseResponseStep(step, fallbackID) {
  let messageID = null;
  const walk = (node, depth) => {
    if (depth > 15 || node == null) return;
    if (Array.isArray(node)) {
      if (
        node.length >= 4 &&
        node[0] === 5 &&
        (node[1] === "replaceOptimisticMessage" || node[1] === "replaceOptimsiticMessage") &&
        typeof node[2] === "string"
      ) {
        messageID = node[2];
      }
      for (const item of node) walk(item, depth + 1);
    } else if (typeof node === "object") {
      for (const key in node) walk(node[key], depth + 1);
    }
  };
  walk(step, 0);
  return messageID || fallbackID;
}

function extractStepError(step) {
  let message = null;
  let code = null;
  const walk = (node, depth) => {
    if (depth > 20 || node == null) return;
    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i++) {
        if (node[i] === "markOptimisticMessageFailed" && typeof node[i + 2] === "string") message = node[i + 2];
        if (node[i] === "updateSubscriptErrorMessage" && typeof node[i + 3] === "string") message = node[i + 3];
        if (node[i] === "Write error response from server") code = "SERVER_WRITE_ERROR";
        walk(node[i], depth + 1);
      }
    } else if (typeof node === "object") {
      for (const key in node) walk(node[key], depth + 1);
    }
  };
  walk(step, 0);
  if (!message && !code) return null;
  const err = new Error(message || code);
  err.code = code || "STEP_ERROR";
  return err;
}

function mapSongsToStickerItems(songs) {
  return (Array.isArray(songs) ? songs : [])
    .map((song) => {
      if (!song || !song.audio_cluster_id) return null;
      const startTime =
        Array.isArray(song.highlights) && song.highlights.length ? String(song.highlights[0]) : "1500";
      return {
        ...song,
        song_id: String(song.audio_cluster_id),
        song_title: (song.title && song.title.text) || song.song_title || "",
        song_subtitle: (song.subtitle && song.subtitle.text) || song.song_subtitle || "",
        start_time: startTime,
        is_explicit: !!song.is_explicit
      };
    })
    .filter(Boolean);
}

function findSongNodes(node, depth, out, seen) {
  if (depth > 25 || node == null) return;
  if (Array.isArray(node)) {
    for (const item of node) findSongNodes(item, depth + 1, out, seen);
    return;
  }
  if (typeof node !== "object") return;
  if (node.audio_cluster_id && !seen.has(node)) {
    seen.add(node);
    out.push(node);
  }
  for (const key in node) {
    if (Object.prototype.hasOwnProperty.call(node, key)) findSongNodes(node[key], depth + 1, out, seen);
  }
}

function extractSongsFromResponse(resData) {
  const out = [];
  findSongNodes(resData, 0, out, new Set());
  return out;
}

function readSavedToken() {
  try {
    const tokenPath = path.join(process.cwd(), "data", "tokens.json");
    if (!fs.existsSync(tokenPath)) return null;
    const data = JSON.parse(fs.readFileSync(tokenPath, "utf8") || "{}");
    return data.EAAD || data.EAAD6V7 || data.EAAAAU || data.token || null;
  } catch (e) {
    return null;
  }
}

function resolveAccessToken(api, ctx) {
  return (async () => {
    let token = readSavedToken();
    if (!token && ctx.access_token && ctx.access_token !== "NONE") token = ctx.access_token;
    if (!token && typeof api.getToken === "function") {
      try {
        token = await api.getToken("EAAD");
      } catch (e) {
        token = null;
      }
    }
    return token || null;
  })();
}

function fetchMessengerMusicPicker({ accessToken, searchText, pageSize, userAgent }) {
  return new Promise((resolve, reject) => {
    const deviceId = crypto.randomUUID();
    const appScopeId = crypto.randomUUID();
    const clientTraceId = crypto.randomUUID();
    const connUuidClient = crypto.randomUUID().replace(/-/g, "");

    const form = {
      method: "post",
      pretty: "false",
      format: "json",
      server_timestamps: "true",
      locale: "vi_VN",
      fb_api_req_friendly_name: "FetchMessengerMusicPickerOptimalQuery",
      fb_api_caller_class: "graphservice",
      client_doc_id: "132851658514471529076136953628",
      fb_api_client_context: JSON.stringify({ is_background: false }),
      variables: JSON.stringify({
        params: {
          search_text: searchText || null,
          product: PRODUCT_STICKER,
          page_size: pageSize,
          end_cursor: null
        },
        browse_session_id: crypto.randomUUID()
      }),
      fb_api_analytics_tags: JSON.stringify(["GraphServices"]),
      client_trace_id: clientTraceId
    };

    request.post(
      {
        url: GRAPHQL_URL,
        form: form,
        timeout: 60000,
        gzip: true,
        headers: {
          "User-Agent": userAgent || DEFAULT_ORCA_UA,
          "Accept-Encoding": "gzip, deflate",
          "Content-Type": "application/x-www-form-urlencoded",
          "x-tigon-is-retry": "False",
          "x-fb-network-properties": "Wifi;Validated;",
          "x-fb-connection-type": "WIFI",
          "app-scope-id-header": appScopeId,
          "x-fb-sim-hni": "45201",
          "x-fb-net-hni": "45201",
          "x-zero-eh": DEFAULT_X_ZERO_EH,
          "x-graphql-client-library": "graphservice",
          "x-zero-f-device-id": deviceId,
          "x-fb-friendly-name": "FetchMessengerMusicPickerOptimalQuery",
          "x-fb-rmd": "state=URL_ELIGIBLE",
          "x-fb-request-analytics-tags": JSON.stringify({
            network_tags: {
              product: "256002347743983",
              request_category: "graphql",
              purpose: "none",
              retry_attempt: "0"
            },
            application_tags: "graphservice"
          }),
          "x-fb-http-engine": "Tigon/Liger",
          "x-fb-client-ip": "True",
          "x-fb-server-cluster": "True",
          "x-fb-conn-uuid-client": connUuidClient,
          authorization: `OAuth ${accessToken}`
        }
      },
      (err, res, body) => {
        if (err) return reject(err);
        if (res.statusCode !== 200) {
          return reject(new Error(`FetchMessengerMusicPickerOptimalQuery failed - Status ${res.statusCode}`));
        }
        let data;
        try {
          data = JSON.parse(body);
        } catch (e) {
          return reject(new Error("Không thể parse phản hồi từ Facebook"));
        }
        if (data.errors && data.errors.length) {
          return reject(new Error(data.errors[0].message || "GraphQL error"));
        }
        const container = data.data && data.data.msgr_music_picker_container_v2;
        const songs = (container && container.songs) || extractSongsFromResponse(data);
        resolve(mapSongsToStickerItems(songs));
      }
    );
  });
}

function publishMusicSticker(ctx, messagePayload, otid, threadID, callback) {
  return new Promise((resolve, reject) => {
    if (!mqttReady(ctx)) {
      const err = new Error("MQTT client is not connected");
      if (callback) callback(err);
      return reject(err);
    }

    if (typeof ctx.wsReqNumber !== "number") ctx.wsReqNumber = 0;
    if (typeof ctx.wsTaskNumber !== "number") ctx.wsTaskNumber = 0;
    const requestId = ++ctx.wsReqNumber;
    const taskId = ++ctx.wsTaskNumber;
    const tasks = [
      {
        context: {
          trace_id: (Math.floor(Math.random() * 0xffffffff) | 0) - 0x7fffffff,
          trace_type: 0
        },
        data_trace_id: trace(),
        failure_count: null,
        label: "46",
        payload: JSON.stringify(messagePayload),
        queue_name: String(threadID),
        task_id: String(taskId)
      }
    ];
    const content = {
      app_id: pick(APP_ID_POOL),
      payload: JSON.stringify({
        epoch_id: utils.generateOfflineThreadingID(),
        tasks,
        version_id: VERSION_POOL[0],
        data_trace_id: trace()
      }),
      request_id: requestId,
      type: 3
    };

    let timer = null;
    let done = false;
    let fallbackMid = null;

    const cleanup = () => {
      if (done) return;
      done = true;
      if (timer) clearTimeout(timer);
      ctx.mqttClient.removeListener("message", onMessage);
    };

    const onMessage = (topic, message) => {
      if (topic !== "/ls_resp") return;
      let json;
      try {
        json = JSON.parse(message.toString("utf8"));
      } catch (e) {
        return;
      }
      if (String(json.request_id) !== String(requestId)) return;

      try {
        if (typeof json.payload === "string") {
          const midMatch = json.payload.match(/mid\.\$[A-Za-z0-9._-]+/);
          if (midMatch) fallbackMid = midMatch[0];
          const first = json.payload.trim()[0];
          if (first === "{" || first === "[") json.payload = JSON.parse(json.payload);
        }

        const step = json.payload && json.payload.step;
        const stepErr = step ? extractStepError(step) : null;
        if (stepErr) {
          cleanup();
          if (callback) callback(stepErr);
          return reject(stepErr);
        }

        const result = {
          body: null,
          messageID: step ? parseResponseStep(step, otid) : fallbackMid || otid,
          threadID: String(threadID)
        };
        cleanup();
        if (callback) callback(null, result);
        resolve(result);
      } catch (err) {
        cleanup();
        if (callback) callback(err);
        reject(err);
      }
    };

    ctx.mqttClient.on("message", onMessage);
    timer = setTimeout(() => {
      cleanup();
      const err = new Error(`Music sticker send timeout after 30s (thread ${threadID})`);
      if (callback) callback(err);
      reject(err);
    }, 30000);
    if (timer.unref) timer.unref();

    ctx.mqttClient.publish("/ls_req", JSON.stringify(content), { qos: 1, retain: false }, (err) => {
      if (err) {
        cleanup();
        if (callback) callback(err);
        reject(err);
      }
    });
  });
}

module.exports = function (defaultFuncs, api, ctx) {
  function searchMusic(keyword, pageSize, callback) {
    let resolveFunc;
    let rejectFunc;
    const returnPromise = new Promise((resolve, reject) => {
      resolveFunc = resolve;
      rejectFunc = reject;
    });

    if (typeof pageSize === "function") {
      callback = pageSize;
      pageSize = 20;
    }
    pageSize = typeof pageSize === "number" && Number.isFinite(pageSize) ? pageSize : 20;

    const cb = (err, data) => {
      if (typeof callback === "function") callback(err, data);
      if (err) return rejectFunc(err);
      resolveFunc(data || []);
    };

    (async () => {
      try {
        const token = await resolveAccessToken(api, ctx);
        if (!token) throw new Error("Thiếu access token (EAAD) để tìm Music Sticker. Hãy set ctx.access_token hoặc data/tokens.json.");
        const stickers = await fetchMessengerMusicPicker({
          accessToken: token,
          searchText: keyword,
          pageSize,
          userAgent: ctx.globalOptions && ctx.globalOptions.userAgent
        });
        cb(null, stickers);
      } catch (err) {
        cb(err);
      }
    })();

    return returnPromise;
  }

  function sendMusicSticker(musicSticker, threadID, callback) {
    let resolveFunc;
    let rejectFunc;
    const returnPromise = new Promise((resolve, reject) => {
      resolveFunc = resolve;
      rejectFunc = reject;
    });
    const cb = callback || ((err, data) => (err ? rejectFunc(err) : resolveFunc(data)));

    if (!musicSticker || !musicSticker.song_id) {
      const err = new Error("Music sticker metadata is required (song_id is required)");
      cb(err);
      return returnPromise;
    }
    if (threadID == null || threadID === "") {
      const err = new Error("threadID is required");
      cb(err);
      return returnPromise;
    }

    const otid = utils.generateOfflineThreadingID();
    const metadata = {
      xma_music_sticker_message_metadata: {
        song_id: String(musicSticker.song_id),
        start_time: musicSticker.start_time == null ? "1500" : String(musicSticker.start_time),
        song_title: musicSticker.song_title || "",
        song_subtitle: musicSticker.song_subtitle || "",
        is_explicit: !!musicSticker.is_explicit
      }
    };
    const payload = {
      thread_id: toNum(threadID),
      otid,
      source: 0,
      send_type: 2,
      sync_group: 1,
      mark_thread_read: 0,
      metadata_dataclass: JSON.stringify(metadata),
      dataclass_params: JSON.stringify({
        logging_metadata: {
          content_model: null,
          feature_tags: ["IS_NOT_DIALTONE"]
        },
        product_params: null
      }),
      navigation_chain: buildNavigationChain()
    };

    publishMusicSticker(ctx, payload, otid, threadID, cb)
      .then(resolveFunc)
      .catch((err) => {
        rejectFunc(err);
      });

    return returnPromise;
  }

  return {
    searchMusic,
    sendMusicSticker
  };
};