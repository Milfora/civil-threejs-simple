import * as THREE from 'three';
import { HeightFunction } from './surface';

export interface RoadTemplate {
	laneWidth: number; // each side
	shoulderWidth: number; // each side
	crossfallLane: number; // slope dz/dx⊥ for lane (per side, signed by side)
	crossfallShoulder: number; // slope for shoulder (per side, signed by side)
}

export function createRoadwayMesh(
	centerline: readonly THREE.Vector2[],
	heightFn: HeightFunction,
	template: RoadTemplate
): THREE.Mesh {
	// Build a thin ribbon surface using centerline tangents and template offsets, sampling at each polyline vertex
	const laneW = template.laneWidth;
	const shW = template.shoulderWidth;
	const half = laneW + shW; // left/right extent of template in meters

	const positions: number[] = [];
	const normals: number[] = [];
	const uvs: number[] = [];
	const indices: number[] = [];

	const offsets = [-half, -laneW, 0, laneW, half];

	const up = new THREE.Vector3(0, 0, 1);

	for (let i = 0; i < centerline.length; i++) {
		const c = centerline[i];
		const prev = centerline[Math.max(0, i - 1)];
		const next = centerline[Math.min(centerline.length - 1, i + 1)];
		const tan2 = new THREE.Vector2().subVectors(next, prev).normalize();
		const n2 = new THREE.Vector2(-tan2.y, tan2.x).normalize(); // left normal in XY

		// Crossfall sign by side relative to center (negative to right)
		for (let j = 0; j < offsets.length; j++) {
			const s = offsets[j];
			const off = new THREE.Vector2(c.x + n2.x * s, c.y + n2.y * s);
			// Crossfall: piecewise slope depending on |s|
			const sideSign = Math.sign(s) || 0; // -1 left, +1 right, 0 center
			const slope = (Math.abs(s) <= laneW ? template.crossfallLane : template.crossfallShoulder) * sideSign;
			const zProfile = heightFn(off.x, off.y);
			const z = zProfile + slope * s; // linear across the offset
			positions.push(off.x, off.y, z);
			normals.push(0, 0, 1);
			uvs.push(i / (centerline.length - 1), (s + half) / (2 * half));
		}
	}

	const cols = offsets.length;
	const rows = centerline.length;
	for (let r = 0; r < rows - 1; r++) {
		for (let c = 0; c < cols - 1; c++) {
			const i0 = r * cols + c;
			const i1 = i0 + 1;
			const i2 = i0 + cols;
			const i3 = i2 + 1;
			indices.push(i0, i2, i1);
			indices.push(i1, i2, i3);
		}
	}

	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
	geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
	geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
	geometry.setIndex(indices);
	geometry.computeVertexNormals();

	const material = new THREE.MeshStandardMaterial({
		color: 0x6e737a,
		metalness: 0.0,
		roughness: 1.0,
		side: THREE.DoubleSide
	});

	const mesh = new THREE.Mesh(geometry, material);
	mesh.castShadow = false;
	mesh.receiveShadow = false;
	mesh.renderOrder = 3;
	return mesh;
}

export function createRoadEdges(centerline: readonly THREE.Vector2[], template: RoadTemplate): THREE.LineSegments {
	const laneW = template.laneWidth;
	const shW = template.shoulderWidth;
	const half = laneW + shW;

	const segments: number[] = [];
	for (let i = 0; i < centerline.length; i++) {
		const c = centerline[i];
		const prev = centerline[Math.max(0, i - 1)];
		const next = centerline[Math.min(centerline.length - 1, i + 1)];
		const tan2 = new THREE.Vector2().subVectors(next, prev).normalize();
		const n2 = new THREE.Vector2(-tan2.y, tan2.x).normalize();
		const lOuter = new THREE.Vector3(c.x + n2.x * -half, c.y + n2.y * -half, 0);
		const rOuter = new THREE.Vector3(c.x + n2.x * +half, c.y + n2.y * +half, 0);
		segments.push(lOuter.x, lOuter.y, lOuter.z, rOuter.x, rOuter.y, rOuter.z);
	}

	const geom = new THREE.BufferGeometry();
	geom.setAttribute('position', new THREE.Float32BufferAttribute(segments, 3));
	const mat = new THREE.LineBasicMaterial({ color: 0x9aa3ad });
	const lines = new THREE.LineSegments(geom, mat);
	lines.renderOrder = 4;
	return lines;
}


