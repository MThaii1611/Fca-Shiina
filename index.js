'use strict';
/* eslint-disable linebreak-style */
const utils = require('./utils');
global.Fca = new Object({
    isThread: new Map(),
    isUser: new Map(),
    startTime: Date.now(),
    Setting: new Map(),
    Version: require('./package.json').version,
    Require: new Object({
        fs: require("fs"),
        Fetch: require('got'),
        log: require("npmlog"),
        utils: require("./utils.js"),
        logger: require('./shiina/logger.js'),
        languageFile: require('./shiina/Language/index.json'),
        Security: null
    }),
    getText: function(/** @type {any[]} */...Data) {
        var Main = (Data.splice(0,1)).toString();
            for (let i = 0; i < Data.length; i++) Main = Main.replace(RegExp(`%${i + 1}`, 'g'), Data[i]);
        return Main;
    },
    Data: new Object({
        ObjFastConfig: {
            "version": "1.0.1",
            "Language": "vi",
            "MainColor": "#9900FF",
            "MainName": "[ SHIINA-FCA ]",
            "DevMode": false,
            "AntiSendAppState": true,
            "AutoRestartMinutes": 0,
            "RestartMQTT_Minutes": 0,
            "ThreadCache": {
                "MaxAgeMs": 900000,
                "SweepIntervalMs": 900000
            },
            "Websocket_Extension": {
                "Status": false,
                "ResetData": false,
                "AppState_Path": "appstate.json"
            },
            "AntiGetInfo": {
                "Database_Type": "default",
                "AntiGetThreadInfo": false,
                "AntiGetUserInfo": false
            },
            "AntiStuckAndMemoryLeak": {
                "AutoRestart": {
                    "Use": false,
                    "Explain": "When this feature is turned on, the system will continuously check and confirm that if memory usage reaches 90%, it will automatically restart to avoid freezing or stopping."
                },
                "LogFile": {
                    "Use": false,
                    "Explain": "Record memory usage logs to fix errors. Default location: ShiinaFca_Database/memory.log"
                }
            }
        },
        CountTime: function() {
            var fs = global.Fca.Require.fs;
            if (fs.existsSync(__dirname + '/shiina/CountTime.json')) {
                try {
                    var data = Number(fs.readFileSync(__dirname + '/shiina/CountTime.json', 'utf8')),
                    hours = Math.floor(data / (60 * 60));
                }
                catch (e) {
                    fs.writeFileSync(__dirname + '/shiina/CountTime.json', 0);
                    hours = 0;
                }
            }
            else {
                hours = 0;
            }
            return `${hours} Hours`;
        }
    }),
    Action: async function(Type, ctx, Code, defaultFuncs) {
        switch (Type) {
            default: {
                require('npmlog').Error("Invalid Message!");
            };
        }
    }
});

try {
    let Boolean_Fca = ["AntiSendAppState","DevMode"];
    let String_Fca = ["MainName","Language","version","MainColor"];
    let Number_Fca = ["AutoRestartMinutes","RestartMQTT_Minutes"];
    let Object_Fca = ["AntiGetInfo","Websocket_Extension","AntiStuckAndMemoryLeak","ThreadCache"];
    let All_Variable = Boolean_Fca.concat(String_Fca,Number_Fca,Object_Fca);

    if (!global.Fca.Require.fs.existsSync(process.cwd() + '/Shiina-ConfigFca.json')) {
        global.Fca.Require.fs.writeFileSync(process.cwd() + "/Shiina-ConfigFca.json", JSON.stringify(global.Fca.Data.ObjFastConfig, null, "\t"));
        process.exit(1);
    }

try {
    var Data_Setting = require(process.cwd() + "/Shiina-ConfigFca.json");
}
catch (e) {
    global.Fca.Require.logger.Error('Detect Your Shiina-ConfigFca Settings Invalid!, Carry out default restoration');
    global.Fca.Require.fs.writeFileSync(process.cwd() + "/Shiina-ConfigFca.json", JSON.stringify(global.Fca.Data.ObjFastConfig, null, "\t"));     
    process.exit(1)
}
    if (global.Fca.Require.fs.existsSync(process.cwd() + '/Shiina-ConfigFca.json')) {
        
        for (let i of All_Variable) {
            if (Data_Setting[i] == undefined) {
                Data_Setting[i] = global.Fca.Data.ObjFastConfig[i];
                global.Fca.Require.fs.writeFileSync(process.cwd() + "/Shiina-ConfigFca.json", JSON.stringify(Data_Setting, null, "\t"));
            }
            else continue; 
        }

        for (let i in Data_Setting) {
            if (Boolean_Fca.includes(i)) {
                if (global.Fca.Require.utils.getType(Data_Setting[i]) != "Boolean") logger.Error(i + " Is Not A Boolean, Need To Be true Or false !", function() { process.exit(0) });
                else continue;
            }
            else if (String_Fca.includes(i)) {
                if (global.Fca.Require.utils.getType(Data_Setting[i]) != "String") logger.Error(i + " Is Not A String, Need To Be String!", function() { process.exit(0) });
                else continue;
            }
            else if (Number_Fca.includes(i)) {
                if (global.Fca.Require.utils.getType(Data_Setting[i]) != "Number") logger.Error(i + " Is Not A Number, Need To Be Number !", function() { process.exit(0) });
                else continue;
            }
            else if (Object_Fca.includes(i)) {
                if (global.Fca.Require.utils.getType(Data_Setting[i]) != "Object") {
                    Data_Setting[i] = global.Fca.Data.ObjFastConfig[i];
                    global.Fca.Require.fs.writeFileSync(process.cwd() + "/Shiina-ConfigFca.json", JSON.stringify(Data_Setting, null, "\t"));
                }
                else continue;
            }
        }

        for (let i of Object_Fca) {
            const All_Paths = utils.getPaths(global.Fca.Data.ObjFastConfig[i]);
            const Mission = { Main_Path: i, Data_Path: All_Paths }
            for (let i of Mission.Data_Path) {
                if (Data_Setting[Mission.Main_Path] == undefined) {
                    Data_Setting[Mission.Main_Path] = global.Fca.Data.ObjFastConfig[Mission.Main_Path];
                    global.Fca.Require.fs.writeFileSync(process.cwd() + "/Shiina-ConfigFca.json", JSON.stringify(Data_Setting, null, "\t"));      
                }
                const User_Data = (utils.getData_Path(Data_Setting[Mission.Main_Path], i, 0))
                const User_Data_Type = utils.getType(User_Data);
                if (User_Data_Type == "Number") {
                    const Mission_Path = User_Data == 0 ? i : i.slice(0, User_Data); 
                    const Mission_Obj = utils.getData_Path(global.Fca.Data.ObjFastConfig[Mission.Main_Path], Mission_Path, 0);
                    Data_Setting[Mission.Main_Path] = utils.setData_Path(Data_Setting[Mission.Main_Path], Mission_Path, Mission_Obj)
                    global.Fca.Require.fs.writeFileSync(process.cwd() + "/Shiina-ConfigFca.json", JSON.stringify(Data_Setting, null, "\t"));      
                }
            }
        }

        if (!global.Fca.Require.languageFile.some((/** @type {{ Language: string; }} */i) => i.Language == Data_Setting.Language)) { 
            global.Fca.Require.logger.Warning("Not Support Language: " + Data_Setting.Language + " Only 'en' and 'vi'");
            process.exit(0); 
        }
        global.Fca.Require.Language = global.Fca.Require.languageFile.find((/** @type {{ Language: string; }} */i) => i.Language == Data_Setting.Language).Folder;
    } else process.exit(1);
    global.Fca.Require.FastConfig = Data_Setting;

    // Cache sweeper
    (function setupCacheSweeper() {
        const cfg = Data_Setting.ThreadCache || { MaxAgeMs: 900000, SweepIntervalMs: 900000 };
        const maxAgeMs = Number(cfg.MaxAgeMs) > 0 ? Number(cfg.MaxAgeMs) : 900000;
        const sweepIntervalMs = Number(cfg.SweepIntervalMs) > 0 ? Number(cfg.SweepIntervalMs) : 900000;

        setInterval(() => {
            const now = Date.now();
            for (const [id, lastUsed] of global.Fca.isThread) {
                if (now - lastUsed > maxAgeMs) global.Fca.isThread.delete(id);
            }
            for (const [id, lastUsed] of global.Fca.isUser) {
                if (now - lastUsed > maxAgeMs) global.Fca.isUser.delete(id);
            }
        }, sweepIntervalMs).unref();
    })();

    // Non-fatal error handlers
    if (!global.Fca._errorHandlersInstalled) {
        global.Fca._errorHandlersInstalled = true;

        process.on("unhandledRejection", (reason) => {
            try {
                const msg = reason && reason.message ? reason.message : String(reason || "");
                if (msg.includes("connect") || msg.includes("timeout") || msg.includes("ECONN") || msg.includes("ENOTFOUND") || msg.includes("fetch failed")) {
                    return;
                }
            } catch (e) { /* ignore */ }
        });

        process.on("uncaughtException", (error) => {
            try {
                const msg = error.message || String(error || "");
                if (msg.includes("connect") || msg.includes("timeout") || msg.includes("ECONN") || msg.includes("ENOTFOUND") || msg.includes("fetch failed")) {
                    return;
                }
                console.error("Uncaught Exception (non-fatal):", msg);
            } catch (e) { /* ignore */ }
        });
    }
}
catch (e) {
    console.log(e);
    global.Fca.Require.logger.Error();
}

module.exports = function(loginData, options, callback) {
    var login;
    try {
        login = require('./Main');
    }
    catch (e) {
        console.log(e)
    }
    
    try {
        login(loginData, options, callback);
    }
    catch (e) {
        console.log(e)
    }
};
