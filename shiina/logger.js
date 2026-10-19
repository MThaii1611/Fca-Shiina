"use strict";
/**
 * Logger module cho FCA Shiina
 * Màu sắc riêng, format riêng, không phụ thuộc npmlog
 */

let chalk;
try { chalk = require("chalk"); } catch (_) {}

const LABEL = chalk?.hex ? chalk.hex("#9900FF").bold("[ SHIINA-FCA ]") : "[ SHIINA-FCA ]";
const COLORS = {
    normal:  (s) => chalk?.whiteBright ? chalk.whiteBright(s) : String(s),
    success: (s) => chalk?.greenBright ? chalk.greenBright(s) : String(s),
    warn:    (s) => chalk?.yellowBright ? chalk.yellowBright(s) : String(s),
    error:   (s) => chalk?.redBright ? chalk.redBright(s) : String(s),
    info:    (s) => chalk?.cyanBright ? chalk.cyanBright(s) : String(s),
    debug:   (s) => chalk?.gray ? chalk.gray(s) : String(s),
};

function timestamp() {
    const t = new Date().toLocaleTimeString("vi-VN", { hour12: false });
    return chalk?.dim ? chalk.dim(t) : t;
}

const logger = {
    Normal(msg, ...args) {
        console.log(`${timestamp()} ${LABEL} ${COLORS.normal(msg)}`, ...args);
        return msg;
    },
    Success(msg, ...args) {
        console.log(`${timestamp()} ${LABEL} ${COLORS.success(msg)}`, ...args);
        return msg;
    },
    Warn(msg, ...args) {
        console.warn(`${timestamp()} ${LABEL} ${COLORS.warn("⚠ " + msg)}`, ...args);
        return msg;
    },
    Error(msg, ...args) {
        console.error(`${timestamp()} ${LABEL} ${COLORS.error("✖ " + msg)}`, ...args);
        return msg;
    },
    Info(msg, ...args) {
        console.log(`${timestamp()} ${LABEL} ${COLORS.info("ℹ " + msg)}`, ...args);
        return msg;
    },
    Debug(msg, ...args) {
        if (global.Shiina?.debug) {
            console.log(`${timestamp()} ${LABEL} ${COLORS.debug("[DEBUG] " + msg)}`, ...args);
        }
        return msg;
    },
    Raw(msg, ...args) {
        console.log(msg, ...args);
    }
};

module.exports = logger;
