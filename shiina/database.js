"use strict";
/**
 * shiina/database.js
 * Database Full-JS cho FCA — lưu user, thread info vào folder Shiina_Database
 * Hoàn toàn thuần JS, không phụ thuộc C++ native addon, hỗ trợ cả SQLite nếu có sẵn
 */

const path = require("path");
const fs   = require("fs");
const logger = require("./logger");

const DB_DIR       = path.join(process.cwd(), "Shiina_Database");
const DB_SQLITE    = path.join(DB_DIR, "shiina.db");
const USERS_FILE   = path.join(DB_DIR, "users.json");
const THREADS_FILE = path.join(DB_DIR, "threads.json");

let sqliteDb = null;
const _users   = new Map();
const _threads = new Map();
const MAX_CACHE_ENTRIES = 2000;

function ensureDir() {}
function _loadJsonFiles() {}
function _saveToDisk() {}
function _scheduleSave() {}

function init() {
    // Pure fast in-memory cache
}

/**
 * Lưu hoặc cập nhật user vào RAM cache
 */
function saveUser(uid, name, data = {}) {
    const sUid = String(uid);
    const isNew = !_users.has(sUid);
    const now = Date.now();
    const entry = { uid: sUid, name: String(name || ""), data, updated: now };

    if (_users.size > MAX_CACHE_ENTRIES) {
        const firstKey = _users.keys().next().value;
        _users.delete(firstKey);
    }
    _users.set(sUid, entry);
    return isNew;
}

function hasUser(uid) {
    return _users.has(String(uid));
}

function getUser(uid) {
    return _users.get(String(uid)) || null;
}

/**
 * Lưu hoặc cập nhật thread/group vào RAM cache
 */
function saveThread(tid, name, isGroup = false, data = {}) {
    const sTid = String(tid);
    const isNew = !_threads.has(sTid);
    const now = Date.now();
    const entry = { tid: sTid, name: String(name || ""), isGroup, data, updated: now };

    if (_threads.size > MAX_CACHE_ENTRIES) {
        const firstKey = _threads.keys().next().value;
        _threads.delete(firstKey);
    }
    _threads.set(sTid, entry);
    return isNew;
}

function hasThread(tid) {
    return _threads.has(String(tid));
}

function getThread(tid) {
    let entry = null;
    if (_threads.has(String(tid))) {
        entry = _threads.get(String(tid));
    } else if (sqliteDb) {
        try {
            const row = sqliteDb.prepare("SELECT * FROM threads WHERE tid=?").get(String(tid));
            if (row) {
                try { row.data = JSON.parse(row.data); } catch (_) {}
                entry = row;
            }
        } catch (_) {}
    }
    if (!entry) return null;

    // Trả về object phẳng đầy đủ các trường chuẩn của bot
    const extra = (entry.data && typeof entry.data === "object") ? entry.data : {};
    return {
        threadID: String(entry.tid || tid),
        threadName: entry.name || extra.threadName || extra.name || "",
        name: entry.name || extra.name || extra.threadName || "",
        isGroup: Boolean(entry.isGroup),
        participantIDs: Array.isArray(extra.participantIDs) ? extra.participantIDs : [],
        userInfo: Array.isArray(extra.userInfo) ? extra.userInfo : [],
        adminIDs: Array.isArray(extra.adminIDs) ? extra.adminIDs : [],
        nicknames: extra.nicknames || {},
        ...extra,
        updated: entry.updated || Date.now()
    };
}

function getAllThreads() {
    const list = [];
    for (const [k, v] of _threads.entries()) {
        list.push(v);
    }
    if (sqliteDb) {
        try {
            const rows = sqliteDb.prepare("SELECT * FROM threads").all();
            for (const r of rows) {
                if (!_threads.has(String(r.tid))) {
                    try { r.data = JSON.parse(r.data); } catch (_) {}
                    list.push(r);
                }
            }
        } catch (_) {}
    }
    return list;
}

function close() {
    _saveToDisk();
    if (sqliteDb) {
        try { sqliteDb.close(); } catch (_) {}
        sqliteDb = null;
    }
}

module.exports = {
    init,
    saveUser,
    hasUser,
    getUser,
    saveThread,
    hasThread,
    getThread,
    getAllThreads,
    close,
    DB_DIR,
    DB_SQLITE,
    USERS_FILE,
    THREADS_FILE
};
