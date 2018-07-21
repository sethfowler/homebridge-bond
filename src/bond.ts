import * as request from 'request-promise';
import * as Promise from 'bluebird';

export interface Session {
  key: string;
  token: string;
}

export interface Command {
  id: number;
  name: string;
  propertyId: string;
}

export interface Device {
  id: number;
  type: string;
  room: string;
  propertyId: string;
  commands: Command[];
  bondId: string;
}

export interface Fan extends Device {
  speed: number;
  direction: number;
  lightState: number;
}

export class Bond {
  public id: string;
  public devices: Device[];
  private sequence: number = 0;

  constructor(response: any) {
    this.id = response.id;
    let commandMap = new Map<number, any>();
    for (let obj of response.commands) {
      if (commandMap.has(obj.device)) {
        var cmds = commandMap.get(obj.device);
        cmds.push(obj);
        commandMap.set(obj.device, cmds);
      } else {
        commandMap.set(obj.device, [obj]);
      }
    }
    var devices: Device[] = [];
    for (let [deviceId, objs] of commandMap.entries()) {
      var commands: Command[] = [];
      for (let obj of objs) {
        commands.push(<Command>{
          id: obj.id,
          name: obj.command_type,
          propertyId: obj.device_property_command_id
        });
      }
      const device: Device = {
        id: objs[0].id,
        type: objs[0].device_type,
        room: objs[0].location_type,
        propertyId: objs[0].device_property_id,
        commands: commands,
        bondId: this.id,
      };
      if (device.type == "Fan") {
        const fan = device as Fan;
        fan.speed = 0;
        fan.direction = 0;
        fan.lightState = 0;
      }
      devices.push(device);
    }
    this.devices = devices;
  }

  public powerOffCommand(device: Fan): Command {
    return this.speedCommand(device, 0);
  }
  public powerOnCommand(device: Fan): Command {
    return this.speedCommand(device, 1);
  }
  public speedCommand(device: Fan, speed: number): Command {
    return this.stateCommand(device, speed, device.lightState);
  }
  public lightOffCommand(device: Fan): Command {
    return this.stateCommand(device, device.speed, 0);
  }
  public lightOnCommand(device: Fan): Command {
    return this.stateCommand(device, device.speed, 1);
  }
  public stateCommand(device: Fan, speed: number, lightState: number): Command {
    if (speed < 0) { speed = 0; }
    if (speed == 0) {
      if (lightState) {
        return this.commandForName(device, "Light Toggle");  // No fan, light on.
      } else {
        return this.commandForName(device, "Power Toggle");  // No fan, no light.
      }
    }

    // Speeds 1-3 have the light on; speeds 4-6 are the same speeds, but with
    // the light off.
    if (speed > 3) { speed = 3; }
    if (!lightState) { speed += 3; }
    return this.commandForName(device, "Speed " + speed);
  }

  public commandForName(device: Device, name: string): Command {
    return (device.commands
      .filter(command => {
        return command.name == name;
      }) || [null])[0];
  }

  public sendCommand(session: Session, command: Command, device: Device): Promise<void> {
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
