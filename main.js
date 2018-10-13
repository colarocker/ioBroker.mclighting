'use strict';
var utils = require(__dirname + '/lib/utils');
var adapter = new utils.Adapter('mclighting');
const WebSocket = require('ws');
var ws, state_current = {},
    list_modes = null,
    flag = false,
    isAlive = false;
var pingTimer, timeoutTimer;
var rgbw;

adapter.on('unload', function (callback) {
    try {
        adapter.log.info('cleaned everything up...');
        callback();
    } catch (e) {
        callback();
    }
});

adapter.on('objectChange', function (id, obj) {
    adapter.log.info('objectChange ' + id + ' ' + JSON.stringify(obj));
});

// is called if a subscribed state changes
adapter.on('stateChange', function (id, state) {
    if (state && !state.ack) {
        adapter.log.debug('stateChange ' + id + ' ' + JSON.stringify(state));
        var sendChar = '*';
        if (state_current.ws2812fx_mode !== 0) {
            sendChar = '#';
        }
        var ids = id.split(".");
        var name = ids[ids.length - 2].toString();
        var command = ids[ids.length - 1].toString();
        var val = state.val;
        if (command == 'mode') {
            send('=' + val);
        }
        if (command == 'fx_mode') {
            send('/' + val);
        }
        if (command == 'color') {
            var c = val.split(",");
            if (c.length >= 3) {
                var r = c[0] || 0;
                var g = c[1] || 0;
                var b = c[2] || 0;
                if (c.length >= 4 && rgbw) {
                    var w = c[3] || 0;
                    send(sendChar + rgbToHex(parseInt(r), parseInt(g), parseInt(b), parseInt(w)));
                } else {
                    send(sendChar + rgbToHex(parseInt(r), parseInt(g), parseInt(b)));
                }
            }
        }
        if (command == 'color_R' || command == 'color_G' || command == 'color_B' || command == 'color_W') {
            if (!flag) {
                flag = true;
                setTimeout(function () {
                    var r, g, b, w;
                    adapter.getState('color_R', function (err, state) {
                        if (!err) {
                            r = state.val;
                            adapter.getState('color_G', function (err, state) {
                                if (!err) {
                                    g = state.val;
                                    adapter.getState('color_B', function (err, state) {
                                        if (!err) {
                                            b = state.val;
                                            if (rgbw) {
                                                adapter.getState('color_W', function (err, state) {
                                                    if (!err) {
                                                        w = state.val;
                                                        send(sendChar + rgbToHex(r, g, b, w));
                                                        send('$');
                                                    }
                                                });
                                            } else {
                                                send(sendChar + rgbToHex(r, g, b));
                                                send('$');
                                            }
                                        }
                                    });
                                }
                            });
                        }
                    });
                    flag = false;
                }, 1000);
            }
        }
        if (command == rgbw ? 'color_RGBW' : 'color_RGB') {
            val = val.replace('#', '');
            send(sendChar + val);
        }
        if (command == rgbw ? 'set_all_RGBW' : 'set_all_RGB') {
            val = val.replace('#', '');
            send('*' + val);
        }
        if (command == rgbw ? 'single_RGBW' : 'single_RGB') {
            val = val.replace('#', '');
            send('!' + val);
        }
        if (command == rgbw ? 'array_RGBW' : 'array_RGB') {
            if (~val.indexOf('+')) {
                if (val[0] === '+') {
                    send(val);
                } else {
                    send('+' + val);
                }
            } else {
                val = val.replace(/\s/g, '').replace(',', '+').replace('[', '').replace(']', '');
                adapter.log.debug('Send ' + command + ': ' + val);
                send('+' + val);
            }
        }
        if (command == rgbw ? 'range_RGBW' : 'range_RGB') {
            if (~val.indexOf('R')) {
                if (val[0] === 'R') {
                    send(val);
                } else {
                    send('R' + val);
                }
            } else {
                val = val.replace(/\s/g, '').replace(',', 'R').replace('[', '').replace(']', '');
                adapter.log.debug('Send ' + command + ': ' + val);
                send('R' + val);
            }
        }
        if (command == 'speed') {
            if (val > 255) val = 255;
            if (val < 0) val = 0;
            send('?' + val);
        }
        if (command == 'brightness') {
            if (val > 255) val = 255;
            if (val < 0) val = 0;
            send('%' + val);
        }
        if (!flag) {
            send('$');
        }
    }
});

adapter.on('message', function (obj) {
    if (typeof obj === 'object' && obj.message) {
        if (obj.command === 'send') {
            // e.g. send email or pushover or whatever
            console.log('send command');
            // Send response in callback if required
            if (obj.callback) adapter.sendTo(obj.from, obj.command, 'Message received', obj.callback);
        }
    }
});

adapter.on('ready', function () {
    main();
});

var connect = function () {
    var host = adapter.config.host ? adapter.config.host : '127.0.0.1';
    var port = adapter.config.port ? adapter.config.port : 81;
    rgbw = adapter.config.rgbw;
    if (rgbw) {
        adapter.log.info('McLighting connect to: ' + host + ':' + port + ' with RGBW');
    } else {
        adapter.log.info('McLighting connect to: ' + host + ':' + port);
    }

    ws = new WebSocket('ws://' + host + ':' + port, {
        perMessageDeflate: false
    });

    ws.on('open', function open() {
        adapter.log.info(ws.url + ' McLighting connected');
        send('$');
        setTimeout(function () {
            send('~');
        }, 5000);
        pingTimer = setInterval(function () {
            ws.ping('ping', function ack(error) {});
        }, 10000);
        timeoutTimer = setInterval(function () {
            if (!isAlive) {
                ws.close();
            } else {
                isAlive = false;
            }
        }, 60000);
    });

    ws.on('message', function incoming(data) {
        adapter.log.debug('message - ' + data);
        isAlive = true;
        if (data === 'Connected') {
            adapter.setState('info.connection', true, true);
        }
        parse(data);
    });

    ws.on('error', function incoming(data) {
        adapter.log.debug('Error WS - ' + data);
    });
    ws.on('close', function incoming(data) {
        clearInterval(pingTimer);
        clearInterval(timeoutTimer);
        adapter.log.debug('ERROR! WS CLOSE, CODE - ' + data);
        adapter.setState('info.connection', false, true);
        adapter.log.debug('McLighting reconnect after 10 seconds');
        setTimeout(connect, 10000);
    });
    ws.on('pong', function (data) {
        isAlive = true;
        adapter.log.debug(ws.url + ' receive a pong : ' + data);
    });
};

function main() {
    createStates();
    adapter.subscribeStates('*');
    connect();
}

function createStates() {
    adapter.setObjectNotExists(rgbw ? "color_RGBW" : "color_RGB", {
        type: "state",
        common: {
            role: "state",
            name: "Set default color of the lamp",
            type: "string",
            read: true,
            write: true,
            def: false
        }
    });
    adapter.setObjectNotExists(rgbw ? "set_all_RGBW" : "set_all_RGB", {
        type: "state",
        common: {
            role: "state",
            name: "Set default color of the lamp and light all LEDs in that color",
            type: "string",
            read: true,
            write: true,
            def: false
        }
    });
    adapter.setObjectNotExists(rgbw ? "single_RGBW" : "single_RGB", {
        type: "state",
        common: {
            role: "state",
            name: "Light single LEDs in the given color",
            type: "string",
            read: true,
            write: true,
            def: false
        }
    });
    adapter.setObjectNotExists(rgbw ? "array_RGBW" : "array_RGB", {
        type: "state",
        common: {
            role: "state",
            name: "Light multiple LEDs in the given colors",
            type: "string",
            read: true,
            write: true,
            def: false
        }
    });
    adapter.setObjectNotExists(rgbw ? "range_RGBW" : "range_RGB", {
        type: "state",
        common: {
            role: "state",
            name: "Light multiple LED ranges in the given colors",
            type: "string",
            read: true,
            write: true,
            def: false
        }
    });
    if (rgbw) {
        adapter.setObjectNotExists("color_W", {
            type: "state",
            common: {
                role: "state",
                name: "Set default White of the lamp",
                type: "number",
                min: 0,
                max: 255,
                read: true,
                write: true,
                def: false
            }
        });
    }
}

function send(data) {
    ws.send(data, function ack(error) {
        if (error) {
            adapter.log.error('Send command: {' + data + '}, ERROR - ' + error);
            if (~error.toString().indexOf('CLOSED')) {
                adapter.setState('info.connection', false, true);
                connect();
            }
        } else {
            adapter.log.debug('Send command:{' + data + '}');
        }
    });
}

function parse(data) {
    var obj;
    try {
        obj = JSON.parse(data);
        adapter.log.info('data' + data);
        if (obj.mode && obj.brightness) {
            state_current = obj;
            for (var key in obj) {
                if (obj.hasOwnProperty(key)) {
                    adapter.log.info('KEY' + key);
                    adapter.log.info('VALUE' + obj[key]);
                    if (key === 'color') {
                        const length = obj[key].length;

                        if (length >= 3) {
                            setStates('color_R', obj[key][0]);
                            setStates('color_G', obj[key][1]);
                            setStates('color_B', obj[key][2]);
                            if (length >= 4 && rgbw) {
                                setStates('color_W', obj[key][3]);
                                setStates('color_RGBW', rgbwToHex(obj[key][0], obj[key][1], obj[key][2], obj[key][3]));
                            } else {
                                setStates('color_RGB', rgbwToHex(obj[key][0], obj[key][1], obj[key][2]));
                            }
                        }
                    }
                    setStates(key, obj[key]);
                }
                if (key === 'ws2812fx_mode') {
                    setStates('fx_mode', obj[key]);
                }
                if (key === 'ws2812fx_mode_name') {
                    setStates('fx_mode_name', obj[key]);
                }

            }
        }
        if (typeof obj[0] === 'object') {
            setStates('list_modes', JSON.stringify(obj));
            list_modes = obj;
        }
    } catch (err) {
        adapter.log.debug('Error parse - ' + err);
    }
}

function setStates(name, val) {
    adapter.log.info("set state name: " + name + " val: " + val);
    adapter.getState(name, function (err, state) {
        if ((err)) {
            adapter.log.warn('Send this data to developers ' + name);
        } else {
            adapter.setState(name, {
                val: val,
                ack: true
            });
        }
    });
}

function rgbToHex(r, g, b, w) {
    return componentToHex(r) + componentToHex(g) + componentToHex(b) + componentToHex(w);
}

function componentToHex(c) {
    if (c) {
        var hex = c.toString(16);
        return hex.length == 1 ? "0" + hex : hex;
    } else {
        return '';
    }
}