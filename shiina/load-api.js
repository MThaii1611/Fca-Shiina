"use strict";
/**
 * shiina/load-api.js
 * Framework Loader độc lập của Shiina FCA
 * Hỗ trợ cả 3 dạng cấu trúc file API:
 *   Dạng 1: Khai báo ở đầu file `"api": "api.xxx"` + `module.exports = function(ctx, http, api) { return ... }`
 *   Dạng 2: Object module `{ "api": "api.xxx", run: function(ctx, http, api) { ... } }`
 *   Dạng 3: Direct Function/Object `{ "api": "api.xxx", execute: async function(...) { ... } }` hoặc export function gắn `.api`
 *
 * Tự động nhận diện file theo framework và tạo api. Sửa `"api": "api.xxx"` thì tên gọi api của FCA tự đổi theo.
 */

const path = require("path");
const fs   = require("fs");
const logger = require("./logger");

const LS_DIR   = path.join(__dirname, "../api/lightspeed");
const HTTP_DIR = path.join(__dirname, "../api/http");

/**
 * Đọc tên API từ file theo cú pháp framework
 * @param {string} filePath
 * @param {any} mod - export của file
 * @param {string} fallback
 * @returns {string}
 */
function resolveApiName(filePath, mod, fallback) {
    // 1. Kiểm tra thuộc tính export từ Object module (Dạng 2 & Dạng 3)
    if (mod && typeof mod === "object" && mod.api) {
        return String(mod.api).replace(/^api\./i, "").trim();
    }
    if (typeof mod === "function" && mod.api) {
        return String(mod.api).replace(/^api\./i, "").trim();
    }

    // 2. Quét cú pháp "api": "api.xxx" ở đầu file (Dạng 1)
    try {
        const content = fs.readFileSync(filePath, "utf8");
        const match = content.match(/(?:["']api["']|\bapi)\s*:\s*["'](?:api\.)?([a-zA-Z0-9_$]+)["']/i);
        if (match && match[1]) {
            return match[1].trim();
        }
    } catch (_) {}

    return fallback;
}

/**
 * Khởi tạo handler từ module theo 3 dạng
 * @param {any} mod
 * @param {object} ctx
 * @param {object} http
 * @param {object} api
 * @returns {Function|any}
 */
function resolveHandler(mod, ctx, http, api) {
    if (!mod) return null;

    // Dạng 1: Function factory
    if (typeof mod === "function") {
        const fnStr = Function.prototype.toString.call(mod);
        let result;
        if (/function\s*\(\s*(?:defaultFuncs|_defaultFuncs)\s*,/i.test(fnStr)) {
            const defaultFuncs = ctx.defaultFuncs || {
                get: (url, jar, qs, ctxx) => http.get(url, { params: qs }),
                post: (url, jar, form, ctxx) => http.post(url, form),
                postFormData: (url, jar, form, qs, ctxx) => http.post(url, form, { params: qs })
            };
            result = mod(defaultFuncs, api, ctx);
        } else if (/function\s*\(\s*http\s*,/i.test(fnStr)) {
            result = mod(http, api, ctx);
        } else {
            result = mod(ctx, http, api);
        }
        return typeof result === "function" ? result : mod;
    }

    // Dạng 2 & 3: Object module
    if (typeof mod === "object") {
        // Dạng 2: { run: (ctx, http, api) => ... }
        if (typeof mod.run === "function") {
            const res = mod.run(ctx, http, api);
            return typeof res === "function" ? res : mod.run;
        }

        // Dạng 3a: { handler: (ctx, http, api) => ... }
        if (typeof mod.handler === "function") {
            const res = mod.handler(ctx, http, api);
            return typeof res === "function" ? res : mod.handler;
        }

        // Dạng 3b: { execute: async (...) => ... }
        if (typeof mod.execute === "function") {
            return mod.execute.bind(mod);
        }

        return mod;
    }

    return null;
}

/**
 * Quét và nạp thư mục API
 * @param {string} dir
 * @param {string} type
 * @param {object} api
 * @param {object} ctx
 * @param {object} http
 * @returns {{ total, success, fail, errors }}
 */
function loadDir(dir, type, api, ctx, http) {
    if (!fs.existsSync(dir)) return { total: 0, success: 0, fail: 0, errors: [] };

    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".js") && !f.startsWith("_"));
    let success = 0, fail = 0;
    const errors = [];

    for (const file of files) {
        const filePath = path.join(dir, file);
        try {
            delete require.cache[require.resolve(filePath)];
            const mod = require(filePath);

            const fallbackName = file.replace(/\.js$/, "");
            const apiName = resolveApiName(filePath, mod, fallbackName);
            const handler = resolveHandler(mod, ctx, http, api);

            if (apiName && handler) {
                api[apiName] = handler;
                success++;
            } else {
                fail++;
                errors.push({ file, error: "Không khởi tạo được handler hoặc thiếu tên api" });
            }
        } catch (e) {
            fail++;
            const errMsg = e.message || String(e);
            errors.push({ file, error: errMsg });
        }
    }

    return { total: files.length, success, fail, errors };
}

/**
 * Nạp toàn bộ API cho FCA
 */
function loadAllApis(api, ctx, http) {
    const ls   = loadDir(LS_DIR,   "lightspeed", api, ctx, http);
    const httpApis = loadDir(HTTP_DIR, "http",   api, ctx, http);
    return { ls, http: httpApis };
}

module.exports = { loadAllApis, resolveApiName, resolveHandler };
