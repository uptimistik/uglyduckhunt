const THREE = require('three');
const obj = new THREE.Object3D();
obj.lookAt(new THREE.Vector3(0, 0, -10));
console.log(obj.matrix.elements);
const v = new THREE.Vector3(0, 0, -1).applyQuaternion(obj.quaternion);
console.log("Local -Z becomes:", v);
