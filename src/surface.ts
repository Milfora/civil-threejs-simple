import * as THREE from 'three';

export type HeightFunction = (x: number, y: number) => number;

export const heightAt: HeightFunction = (x, y) => {
	// Smooth analytic height function; fast and visually interesting
	const r2 = x * x + y * y;
	const undulation = 0.6 * Math.sin(0.5 * x) * Math.cos(0.4 * y);
	const mound = 0.8 * Math.exp(-0.04 * r2);
	const ridge = 0.25 * Math.sin(0.25 * x + 0.15 * y);
	return undulation + mound + ridge;
};

export function createSurfaceMesh(size: number, segments: number, heightFn: HeightFunction): THREE.Mesh {
	// PlaneGeometry lies in XY plane by default (Z is up for our world)
	const geometry = new THREE.PlaneGeometry(size, size, segments, segments);

	const pos = geometry.attributes.position as THREE.BufferAttribute;
	for (let i = 0; i < pos.count; i++) {
		const x = pos.getX(i);
		const y = pos.getY(i);
		const z = heightFn(x, y);
		pos.setZ(i, z);
	}
	pos.needsUpdate = true;
	geometry.computeVertexNormals();

	const material = new THREE.MeshStandardMaterial({
		color: 0x6d7a86,
		metalness: 0.0,
		roughness: 1.0,
		wireframe: true
	});

	const mesh = new THREE.Mesh(geometry, material);
	mesh.receiveShadow = false;
	mesh.castShadow = false;
	return mesh;
}


