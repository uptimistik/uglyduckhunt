const THREE = require('three');
const obj = new THREE.Object3D();
obj.lookAt(new THREE.Vector3(0, 0, -10));
const posZ = new THREE.Vector3(0, 0, 1).applyQuaternion(obj.quaternion);
console.log("Local +Z points to:", posZ);

const cam = new THREE.PerspectiveCamera();
cam.lookAt(new THREE.Vector3(0, 0, -10));
const camPosZ = new THREE.Vector3(0, 0, 1).applyQuaternion(cam.quaternion);
const camNegZ = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
console.log("Camera +Z points to:", camPosZ, "Camera -Z points to:", camNegZ);
