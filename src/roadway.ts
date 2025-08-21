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
		color: 0x90caf9,
		metalness: 0.0,
		roughness: 1.0,
		side: THREE.DoubleSide,
		transparent: true,
		opacity: 0.5
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

function computeChainages(centerline: readonly THREE.Vector2[]): number[] {
	const s: number[] = [0];
	for (let i = 1; i < centerline.length; i++) {
		const d = centerline[i].distanceTo(centerline[i - 1]);
		s.push(s[i - 1] + d);
	}
	return s;
}

export function createRoadwayMeshFromTwoIPs(
	centerline: readonly THREE.Vector2[],
	heightFn: HeightFunction,
	template: RoadTemplate
): THREE.Mesh {
	// Profile: straight line between start and end elevations sampled from existing surface
	if (centerline.length < 2) {
		return new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ visible: false }));
	}
	const chainages = computeChainages(centerline);
	const totalLength = chainages[chainages.length - 1] ?? 1;
	const start = centerline[0];
	const end = centerline[centerline.length - 1];
	const zStart = heightFn(start.x, start.y);
	const zEnd = heightFn(end.x, end.y);

	const laneW = template.laneWidth;
	const shW = template.shoulderWidth;
	const half = laneW + shW;
	const offsets = [-half, -laneW, 0, laneW, half];

	const positions: number[] = [];
	const normals: number[] = [];
	const uvs: number[] = [];
	const indices: number[] = [];

	for (let i = 0; i < centerline.length; i++) {
		const c = centerline[i];
		const prev = centerline[Math.max(0, i - 1)];
		const next = centerline[Math.min(centerline.length - 1, i + 1)];
		const tan2 = new THREE.Vector2().subVectors(next, prev).normalize();
		const n2 = new THREE.Vector2(-tan2.y, tan2.x).normalize();
		const s = chainages[i];
		const t = totalLength > 0 ? s / totalLength : 0;
		const zCenter = THREE.MathUtils.lerp(zStart, zEnd, t);

		for (let j = 0; j < offsets.length; j++) {
			const o = offsets[j];
			const off = new THREE.Vector2(c.x + n2.x * o, c.y + n2.y * o);
			const sideSign = Math.sign(o) || 0;
			const slope = (Math.abs(o) <= laneW ? template.crossfallLane : template.crossfallShoulder) * sideSign;
			const z = zCenter + slope * o;
			positions.push(off.x, off.y, z);
			normals.push(0, 0, 1);
			uvs.push(i / (centerline.length - 1), (o + half) / (2 * half));
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
		color: 0x90caf9,
		metalness: 0.0,
		roughness: 1.0,
		side: THREE.DoubleSide,
		transparent: true,
		opacity: 0.5
	});

	const mesh = new THREE.Mesh(geometry, material);
	mesh.castShadow = false;
	mesh.receiveShadow = false;
	mesh.renderOrder = 3;
	return mesh;
}

export function createRoadEdgesFromTwoIPs(
	centerline: readonly THREE.Vector2[],
	heightFn: HeightFunction,
	template: RoadTemplate
): THREE.LineSegments {
	if (centerline.length < 2) {
		return new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ visible: false }));
	}
	const chainages = computeChainages(centerline);
	const totalLength = chainages[chainages.length - 1] ?? 1;
	const start = centerline[0];
	const end = centerline[centerline.length - 1];
	const zStart = heightFn(start.x, start.y);
	const zEnd = heightFn(end.x, end.y);

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
		const s = chainages[i];
		const t = totalLength > 0 ? s / totalLength : 0;
		const zCenter = THREE.MathUtils.lerp(zStart, zEnd, t);
		const zLOuter = zCenter + (template.crossfallShoulder * -1) * -half; // left side sign = -1
		const zROuter = zCenter + (template.crossfallShoulder * +1) * +half; // right side sign = +1
		const lOuter = new THREE.Vector3(c.x + n2.x * -half, c.y + n2.y * -half, zLOuter);
		const rOuter = new THREE.Vector3(c.x + n2.x * +half, c.y + n2.y * +half, zROuter);
		segments.push(lOuter.x, lOuter.y, lOuter.z, rOuter.x, rOuter.y, rOuter.z);
	}

	const geom = new THREE.BufferGeometry();
	geom.setAttribute('position', new THREE.Float32BufferAttribute(segments, 3));
	const mat = new THREE.LineBasicMaterial({ color: 0x9aa3ad });
	const lines = new THREE.LineSegments(geom, mat);
	lines.renderOrder = 4;
	return lines;
}

function findDaylightIntersection(
	startXY: THREE.Vector2,
	startZ: number,
	dirXY: THREE.Vector2,
	dzPerMeter: number,
	heightFn: HeightFunction
): { x: number; y: number; z: number; s: number } {
	// Root find f(s) = (startZ + dzPerMeter*s) - heightAt(x+dir*s, y+dir*s)
	const maxDistance = 200; // meters
	const step = 2; // initial step
	let s0 = 0;
	let f0 = (startZ) - heightFn(startXY.x, startXY.y);
	let s1 = step;
	let f1 = (startZ + dzPerMeter * s1) - heightFn(startXY.x + dirXY.x * s1, startXY.y + dirXY.y * s1);
	// Expand until sign change or max
	while (Math.sign(f0) === Math.sign(f1) && s1 < maxDistance) {
		s0 = s1; f0 = f1;
		s1 = Math.min(maxDistance, s1 + step);
		f1 = (startZ + dzPerMeter * s1) - heightFn(startXY.x + dirXY.x * s1, startXY.y + dirXY.y * s1);
	}
	let sStar = s1;
	if (Math.sign(f0) !== Math.sign(f1)) {
		// Bisection for robustness
		let a = s0, fa = f0;
		let b = s1, fb = f1;
		for (let i = 0; i < 24; i++) {
			const m = 0.5 * (a + b);
			const fm = (startZ + dzPerMeter * m) - heightFn(startXY.x + dirXY.x * m, startXY.y + dirXY.y * m);
			if (Math.sign(fa) === Math.sign(fm)) { a = m; fa = fm; } else { b = m; fb = fm; }
		}
		sStar = 0.5 * (a + b);
	}
	const x = startXY.x + dirXY.x * sStar;
	const y = startXY.y + dirXY.y * sStar;
	const zSurf = heightFn(x, y);
	return { x, y, z: zSurf, s: sStar };
}

export function createDaylightMeshFromTwoIPs(
	centerline: readonly THREE.Vector2[],
	heightFn: HeightFunction,
	template: RoadTemplate,
	slopeHtoV = 2
): THREE.Mesh {
	if (centerline.length < 2) {
		return new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ visible: false }));
	}
	const chainages = computeChainages(centerline);
	const totalLength = chainages[chainages.length - 1] ?? 1;
	const start = centerline[0];
	const end = centerline[centerline.length - 1];
	const zStart = heightFn(start.x, start.y);
	const zEnd = heightFn(end.x, end.y);

	const laneW = template.laneWidth;
	const shW = template.shoulderWidth;
	const half = laneW + shW;

	const positions: number[] = [];
	const indices: number[] = [];

	for (let i = 0; i < centerline.length; i++) {
		const c = centerline[i];
		const prev = centerline[Math.max(0, i - 1)];
		const next = centerline[Math.min(centerline.length - 1, i + 1)];
		const tan2 = new THREE.Vector2().subVectors(next, prev).normalize();
		const n2 = new THREE.Vector2(-tan2.y, tan2.x).normalize();
		const s = chainages[i];
		const t = totalLength > 0 ? s / totalLength : 0;
		const zCenter = THREE.MathUtils.lerp(zStart, zEnd, t);

		// Left and right outer edge positions and elevations (using shoulder crossfall at outer)
		const oL = -half;
		const oR = +half;
		const leftEdgeXY = new THREE.Vector2(c.x + n2.x * oL, c.y + n2.y * oL);
		const rightEdgeXY = new THREE.Vector2(c.x + n2.x * oR, c.y + n2.y * oR);
		const slopeL = template.crossfallShoulder * Math.sign(oL);
		const slopeR = template.crossfallShoulder * Math.sign(oR);
		const zLeftEdge = zCenter + slopeL * oL;
		const zRightEdge = zCenter + slopeR * oR;

		// Determine cut/fill sign: target slope vertical change direction
		const zSurfLeft = heightFn(leftEdgeXY.x, leftEdgeXY.y);
		const zSurfRight = heightFn(rightEdgeXY.x, rightEdgeXY.y);
		const signL = Math.sign(zSurfLeft - zLeftEdge) || 1;
		const signR = Math.sign(zSurfRight - zRightEdge) || 1;
		const dzds = 1 / Math.max(1e-6, slopeHtoV);
		const dzdsL = signL * dzds;
		const dzdsR = signR * dzds;

		// Outward directions
		const dirLeft = n2.clone().multiplyScalar(-1);
		const dirRight = n2.clone();

		const dl = findDaylightIntersection(leftEdgeXY, zLeftEdge, dirLeft, dzdsL, heightFn);
		const dr = findDaylightIntersection(rightEdgeXY, zRightEdge, dirRight, dzdsR, heightFn);

		// Push vertices in order: L-edge, L-daylight, R-edge, R-daylight
		positions.push(leftEdgeXY.x, leftEdgeXY.y, zLeftEdge);
		positions.push(dl.x, dl.y, dl.z);
		positions.push(rightEdgeXY.x, rightEdgeXY.y, zRightEdge);
		positions.push(dr.x, dr.y, dr.z);
	}

	// Build indices for two strips: left (cols 0-1), right (cols 2-3)
	const colsPerRow = 4;
	const rows = centerline.length;
	for (let r = 0; r < rows - 1; r++) {
		// Left side
		let i0 = r * colsPerRow + 0;
		let i1 = i0 + 1;
		let i2 = i0 + colsPerRow;
		let i3 = i2 + 1;
		indices.push(i0, i2, i1);
		indices.push(i1, i2, i3);
		// Right side
		i0 = r * colsPerRow + 2;
		i1 = i0 + 1;
		i2 = i0 + colsPerRow;
		i3 = i2 + 1;
		indices.push(i0, i2, i1);
		indices.push(i1, i2, i3);
	}

	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
	geometry.setIndex(indices);
	geometry.computeVertexNormals();

	const material = new THREE.MeshStandardMaterial({
		color: 0x64b5f6,
		metalness: 0.0,
		roughness: 1.0,
		side: THREE.DoubleSide,
		transparent: true,
		opacity: 0.45
	});

	const mesh = new THREE.Mesh(geometry, material);
	mesh.renderOrder = 2.5;
	return mesh;
}


