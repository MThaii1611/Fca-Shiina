"use strict";
/**
 * shiina/lightspeed/ls-walker.js
 * Shiina Framework - Duyệt qua Lightspeed step AST tree và gọi visitor cho mỗi procedure call
 */

function unwrapLsVal(val) {
    if (val === undefined || val === null) return null;
    if (typeof val === "object" && !Array.isArray(val) && "value" in val) return unwrapLsVal(val.value);
    if (Array.isArray(val)) {
        if (val.length === 1 && val[0] === 9) return null; // [9] is null in AST
        if (val.length === 2 && (val[0] === 19 || val[0] === 2)) return unwrapLsVal(val[1]); // [19, scalar] or [2, scalar]
        if (val.length === 0) return null;
        return unwrapLsVal(val[val.length - 1]);
    }
    return val;
}

function walkLsStep(node, visitor) {
    if (!node || typeof visitor !== "function") return;

    let stepTree = node;
    while (typeof stepTree === "string") {
        try { stepTree = JSON.parse(stepTree); } catch (_) { break; }
    }
    if (stepTree && typeof stepTree === "object") {
        if (stepTree.step !== undefined) {
            stepTree = stepTree.step;
            while (typeof stepTree === "string") {
                try { stepTree = JSON.parse(stepTree); } catch (_) { break; }
            }
        } else if (stepTree.payload !== undefined) {
            let p = stepTree.payload;
            while (typeof p === "string") {
                try { p = JSON.parse(p); } catch (_) { break; }
            }
            if (p && p.step !== undefined) {
                stepTree = p.step;
                while (typeof stepTree === "string") {
                    try { stepTree = JSON.parse(stepTree); } catch (_) { break; }
                }
            }
        }
    }

    function walk(n) {
        if (!n || typeof n !== "object") return;
        if (Array.isArray(n)) {
            if (n[0] === 5 && typeof n[1] === "string") {
                visitor(n[1], n.slice(2), n);
                return;
            }
            for (let i = 0; i < n.length; i++) {
                walk(n[i]);
            }
        } else {
            for (const key in n) {
                if (Object.prototype.hasOwnProperty.call(n, key)) {
                    walk(n[key]);
                }
            }
        }
    }

    walk(stepTree);
}

module.exports = { walkLsStep, unwrapLsVal };
