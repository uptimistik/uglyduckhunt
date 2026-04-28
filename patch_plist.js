const fs = require('fs');
const plist = require('plist');
const path = 'controller/ios/App/App/Info.plist';
const parsed = plist.parse(fs.readFileSync(path, 'utf8'));
parsed.NSCameraUsageDescription = 'Used to flash the camera light when firing the gun.';
fs.writeFileSync(path, plist.build(parsed));
