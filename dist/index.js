"use strict";
var Accessory, Service, Characteristic, UUIDGen;
const request = require("request-promise");
const Promise = require("bluebird");
const bond_1 = require("./bond");
class BondPlatform {
    constructor(log, config, api) {
        this.log = log;
        this.api = api;
        this.accessories = [];
        this.lastRequest = Promise.resolve();
        let email = config['email'];
        let password = config['password'];
        let that = this;
        api.on('didFinishLaunching', () => {
            that.log(that.accessories.length + " cached accessories were loaded");
            that
                .login(email, password)
                .then(session => {
                that.session = session;
                return that.readBonds();
            })
                .then(bonds => {
                that.bonds = bonds;
                if (bonds.length == 0) {
                    that.log("No new bonds found.");
                }
                else {
                    bonds.forEach(bond => {
                        bond.devices
                            .filter(device => { return !that.deviceAdded(device.id); })
                            .forEach(device => {
                            that.addAccessory(device);
                        });
                    });
                }
            })
                .catch(error => {
                that.log(error);
            });
        });
    }
    addAccessory(device) {
        if (this.deviceAdded(device.id)) {
            this.log(device.id + " has already been added.");
            return;
        }
        if (device.type != "Fan") {
            this.log(device.id + " has an unsupported device type.");
            return;
        }
        var accessory = new Accessory(device.room + " " + device.type, UUIDGen.generate(device.id.toString()));
        accessory.context.device = device;
        accessory.reachable = true;
        accessory
            .addService(Service.Fan, device.room + " " + device.type);
        accessory
            .addService(Service.Lightbulb, device.room + " " + device.type + " Light");
        this.setupObservers(accessory);
        accessory
            .getService(Service.AccessoryInformation)
            .setCharacteristic(Characteristic.SerialNumber, device.id);
        this.api.registerPlatformAccessories('homebridge-bond', 'Bond', [accessory]);
        this.accessories.push(accessory);
    }
    removeAccessory(accessory) {
        this.log("Removing accessory " + accessory.displayName);
        let index = this.accessories.indexOf(accessory);
        if (index > -1) {
            this.accessories.splice(index, 1);
        }
        this.api.unregisterPlatformAccessories('homebridge-bond', 'Bond', [accessory]);
    }
    configureAccessory(accessory) {
        this.accessories.push(accessory);
        if (this.bonds) {
            this.log("Configure Accessory: " + accessory.displayName);
            this.setupObservers(accessory);
        }
        else {
            let that = this;
            let timer = setInterval(() => {
                if (this.bonds) {
                    that.log("Configure Accessory: " + accessory.displayName);
                    that.setupObservers(accessory);
                    clearInterval(timer);
                }
            }, 500);
        }
    }
    setupObservers(accessory) {
        let that = this;
        let device = accessory.context.device;
        let bond = this.bondForIdentifier(device.bondId);
        if (device.type == "Fan" && accessory.getService(Service.Fan)) {
            let fan = device;
            accessory.getService(Service.Lightbulb)
                .getCharacteristic(Characteristic.On)
                .on('set', function (value, callback) {
                // XXX: Having problems with this being delivered in a
                // different order than requests are sent when setting scenes.
                // Probably need our own internal request queue or
                // something...
                let command = value ? bond.lightOnCommand(fan) : bond.lightOffCommand(fan);
                fan.lightState = value ? 1 : 0;
                that.log('HAP: set light to ' + value + '. fan.lightState: ' + fan.lightState + '. sending: ' + (command ? command.name : '?'));
                that.lastRequest = that.lastRequest.then(() => {
                    return bond.sendCommand(that.session, command, fan);
                }).then(() => {
                    that.log('BOND: done setting light to ' + value);
                    callback();
                }).catch(error => {
                    that.log('BOND: error setting light to ' + value);
                    that.log(error);
                    callback();
                });
            })
                .on('get', function (callback) {
                that.log(`HAP: get light state: ${fan.lightState}`);
                callback(null, fan.lightState > 0);
            });
            accessory.getService(Service.Fan)
                .getCharacteristic(Characteristic.RotationDirection)
                .on('set', function (value, callback) {
                // XXX: Is this a third dimension? Do we need versions for
                // light on and off, and for different fan speeds?
                // XXX: Just tested and yes, we do need, I guess, versions for
                // all light states and speeds!!
                // XXX: Disabled for now until this is fixed, since HomeKit
                // sends all possible messages including this one when setting
                // a scene.
                if (true) {
                    that.log('HAP: set direction to ' + value + '. fan.direction: ' + fan.direction + '. sending no command (direction is disabled)');
                    callback();
                    return;
                }
                let commandName = value ? "Reverse" : "Random";
                let command = bond.commandForName(fan, commandName);
                fan.direction = value ? 1 : 0;
                that.log('HAP: set direction to ' + value + '. fan.direction: ' + fan.direction + '. sending: ' + (command ? command.name : '?'));
                that.lastRequest = that.lastRequest.then(() => {
                    return bond.sendCommand(that.session, command, fan);
                }).then(() => {
                    that.log('BOND: done setting direction to ' + value);
                    callback();
                }).catch(error => {
                    that.log('BOND: error setting direction to ' + value);
                    that.log(error);
                    callback();
                });
            })
                .on('get', function (callback) {
                that.log(`HAP: get direction: ${fan.direction}`);
                callback(null, fan.direction > 0);
            });
            accessory.getService(Service.Fan)
                .getCharacteristic(Characteristic.On)
                .on('set', function (value, callback) {
                let desiredSpeed = value ? 1 : 0;
                if (fan.speed !== undefined && (desiredSpeed == fan.speed || (desiredSpeed > 0 && fan.speed > 0))) {
                    that.log('HAP: set fan on to ' + value + '. fan.speed is already: ' + fan.speed + '. sending no command');
                    callback();
                    return;
                }
                let command = value ? bond.powerOnCommand(fan) : bond.powerOffCommand(fan);
                fan.speed = value ? 1 : 0;
                that.log('HAP: set fan on to ' + value + '. fan.speed: ' + fan.speed + '. sending: ' + (command ? command.name : '?'));
                that.lastRequest = that.lastRequest.then(() => {
                    return bond.sendCommand(that.session, command, fan);
                }).then(() => {
                    that.log('BOND: done setting fan on to ' + value);
                    callback();
                }).catch(error => {
                    that.log('BOND: error setting fan on to ' + value);
                    that.log(error);
                    callback();
                });
            })
                .on('get', function (callback) {
                that.log(`HAP: get fan on: ${fan.speed > 0}`);
                callback(null, fan.speed > 0);
            });
            accessory.getService(Service.Fan)
                .getCharacteristic(Characteristic.RotationSpeed)
                .setProps({
                minStep: 33,
                maxValue: 99
            })
                .on('set', function (value, callback) {
                //let commands = bond.sortedSpeedCommands(fan);
                var command = null;
                if (value == 0) {
                    command = bond.powerOffCommand(fan);
                    accessory.context.device.speed = 0;
                }
                else if (value == 33) {
                    //command = commands[0];
                    command = bond.speedCommand(fan, 1);
                    accessory.context.device.speed = 1;
                }
                else if (value == 66) {
                    //command = commands[1];
                    command = bond.speedCommand(fan, 2);
                    accessory.context.device.speed = 2;
                }
                else if (value >= 99) {
                    //command = commands[2];
                    command = bond.speedCommand(fan, 3);
                    accessory.context.device.speed = 3;
                }
                that.log('HAP: set fan speed to ' + value + '. fan.speed: ' + fan.speed + '. sending: ' + (command ? command.name : '?'));
                that.lastRequest = that.lastRequest.then(() => {
                    return bond.sendCommand(that.session, command, fan);
                }).then(() => {
                    that.log('BOND: done setting fan speed to ' + value);
                    callback();
                }).catch(error => {
                    that.log('BOND: error setting fan speed to ' + value);
                    that.log(error);
                    callback();
                });
            })
                .on('get', function (callback) {
                that.log(`HAP: get fan speed: ${fan.speed * 33}`);
                callback(null, fan.speed * 33);
            });
        }
    }
    deviceAdded(id) {
        return this.accessoryForIdentifier(id) != null;
    }
    bondForIdentifier(id) {
        let bonds = this.bonds
            .filter(bond => {
            return bond.id == id;
        });
        return bonds.length > 0 ? bonds[0] : null;
    }
    accessoryForIdentifier(id) {
        let accessories = this.accessories
            .filter(acc => {
            let device = acc.context.device;
            return device.id == id;
        });
        return accessories.length > 0 ? accessories[0] : null;
    }
    login(email, password) {
        let that = this;
        return request({
            method: 'POST',
            uri: 'https://appbond.com/api/v1/auth/login/',
            body: {
                email: email,
                password: password
            },
            json: true
        })
            .then(body => {
            return {
                key: body.key,
                token: body.user.bond_token
            };
        });
    }
    readBonds() {
        return request({
            method: 'GET',
            uri: 'https://appbond.com/api/v1/bonds/',
            headers: {
                Authorization: "Token " + this.session.key
            }
        })
            .then(body => {
            return JSON.parse(body)['results'].map(a => { return new bond_1.Bond(a); });
        });
    }
}
module.exports = function (homebridge) {
    Service = homebridge.hap.Service;
    Characteristic = homebridge.hap.Characteristic;
    Accessory = homebridge.platformAccessory;
    UUIDGen = homebridge.hap.uuid;
    homebridge.registerPlatform('homebridge-bond', 'Bond', BondPlatform, true);
};
