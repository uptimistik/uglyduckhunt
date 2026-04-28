const THREE = require('three');
const wing = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.55).rotateX(-Math.PI/2));
wing.position.set(0.55, 0, 0);

const pivot = new THREE.Group();
pivot.add(wing);
pivot.rotation.z = Math.PI / 4; // Flap up 45 degrees
pivot.updateMatrixWorld(true);

const tip = new THREE.Vector3(1.1, 0, 0); // Right edge of wing
tip.applyMatrix4(pivot.matrixWorld);
console.log("Tip Y after Z rotation:", tip.y); // Should be positive if it flapped up
