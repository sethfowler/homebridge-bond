"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const request = require("request-promise");
class Bond {
    constructor(response) {
        this.sequence = 0;
        this.id = response.id;
        let commandMap = new Map();
        for (let obj of response.commands) {
            if (commandMap.has(obj.device)) {
                var cmds = commandMap.get(obj.device);
                cmds.push(obj);
                commandMap.set(obj.device, cmds);
            }
            else {
                commandMap.set(obj.device, [obj]);
            }
        }
        var devices = [];
        for (let [deviceId, objs] of commandMap.entries()) {
            var commands = [];
            for (let obj of objs) {
                commands.push({
                    id: obj.id,
                    name: obj.command_type,
                    propertyId: obj.device_property_command_id
                });
            }
            const device = {
                id: objs[0].id,
                type: objs[0].device_type,
                room: objs[0].location_type,
                propertyId: objs[0].device_property_id,
                commands: commands,
                bondId: this.id,
            };
            if (device.type == "Fan") {
                const fan = device;
                fan.speed = 0;
                fan.direction = 0;
                fan.lightState = 0;
            }
            devices.push(device);
        }
        this.devices = devices;
    }
    powerOffCommand(device) {
        return this.speedCommand(device, 0);
    }
    powerOnCommand(device) {
        return this.speedCommand(device, 1);
    }
    speedCommand(device, speed) {
        return this.stateCommand(device, speed, device.lightState);
    }
    lightOffCommand(device) {
        return this.stateCommand(device, device.speed, 0);
    }
    lightOnCommand(device) {
        return this.stateCommand(device, device.speed, 1);
    }
    stateCommand(device, speed, lightState) {
        if (speed < 0) {
            speed = 0;
        }
        if (speed == 0) {
            if (lightState) {
                return this.commandForName(device, "Light Toggle"); // No fan, light on.
            }
            else {
                return this.commandForName(device, "Power Toggle"); // No fan, no light.
            }
        }
        // Speeds 1-3 have the light on; speeds 4-6 are the same speeds, but with
        // the light off.
        if (speed > 3) {
            speed = 3;
        }
        if (!lightState) {
            speed += 3;
        }
        return this.commandForName(device, "Speed " + speed);
    }
    commandForName(device, name) {
        return (device.commands
            .filter(command => {
            return command.name == name;
        }) || [null])[0];
    }
    sendCommand(session, command, device) {
        this.sequence++;
        let url = "https://" + this.id + ".local:4433/api/v1/device/" + (parseInt(device.propertyId) - 1) + "/device_property/" + device.propertyId + "/device_property_command/" + command.propertyId + "/run";
        return request({
            method: 'GET',
            uri: url,
            rejectUnauthorized: false,
            headers: {
                'X-Token': session.token,
                'X-Sequence': this.sequence,
                'X-BondDate': (new Date()).toISOString().split(".")[0] + "Z"
            }
        })
            .then(response => {
            return;
        });
    }
}
exports.Bond = Bond;
