const THREE = require('three');
const geo = new THREE.PlaneGeometry(1, 1);
const positions = geo.attributes.position.array;
console.log("Plane Z values:");
for(let i=2; i<positions.length; i+=3) {
  console.log(positions[i]);
}
