import * as THREE from 'three';
import { theme3D } from './theme';
import { HeightFunction } from './surface';

export interface RoadTemplateComponents {
	pavement?: { enabled?: boolean; thickness?: number; color?: string | number };
	kerb?: { enabled?: boolean; width?: number; height?: number; color?: string | number };
	footpath?: { enabled?: boolean; width?: number; thickness?: number; crossfall?: number; color?: string | number };
	daylight?: { enabled?: boolean; slopeHtoV?: number; color?: string | number };
}

export interface RoadTemplate {
	laneWidth: number; // each side
	crossfallLane: number; // slope dz/dx⊥ for lane (per side, signed by side)
	// Extended parameters for closed solids
	pavementThickness?: number; // thickness of pavement slab (m)
	kerbWidth?: number;        // horizontal kerb width outward from lane edge (m)
	kerbHeight?: number;       // vertical rise of kerb from pavement edge (m)
	footpathWidth?: number;    // width outward from kerb outer (m)
	footpathThickness?: number;// thickness of footpath (m)
	crossfallFootpath?: number;// slope for footpath (signed by side, outward)
	// New componentized config (overrides the flat fields when present)
	components?: RoadTemplateComponents;
}

export function createRoadwayMesh(
	centerline: readonly THREE.Vector2[],
	heightFn: HeightFunction,
	template: RoadTemplate
): THREE.Mesh {
	// Build a thin ribbon surface using centerline tangents and template offsets, sampling at each polyline vertex
	const laneW = template.laneWidth;
	const half = laneW; // left/right extent of template in meters

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
			const slope = (Math.abs(s) <= laneW ? template.crossfallLane : template.crossfallLane) * sideSign;
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
		color: theme3D.roadSurface,
		metalness: 0.0,
		roughness: 1.0,
		side: THREE.DoubleSide,
		transparent: true,
		opacity: theme3D.roadSurfaceOpacity
	});

	const mesh = new THREE.Mesh(geometry, material);
	mesh.castShadow = false;
	mesh.receiveShadow = false;
	mesh.renderOrder = 3;
	return mesh;
}

export function createRoadEdges(centerline: readonly THREE.Vector2[], template: RoadTemplate): THREE.LineSegments {
	const laneW = template.laneWidth;
	const half = laneW;
	// Footpath/kerb parameters used to place daylight start at footpath outer edge
	const kerbW = template.kerbWidth ?? 0.25;
	const kerbH = template.kerbHeight ?? 0.125;
	const footW = template.footpathWidth ?? 1.5;
	const xfallFoot = template.crossfallFootpath ?? -0.02;



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
	const mat = new THREE.LineBasicMaterial({ color: theme3D.roadEdges });
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
	template: RoadTemplate,
	startZOverride?: number,
	endZOverride?: number,
	gradeProfile?: { s: number; z: number }[]
): THREE.Mesh {
	// Profile: straight line between start and end elevations sampled from existing surface
	if (centerline.length < 2) {
		return new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ visible: false }));
	}
	const chainages = computeChainages(centerline);
	const totalLength = chainages[chainages.length - 1] ?? 1;
	const start = centerline[0];
	const end = centerline[centerline.length - 1];
	const zStart = (startZOverride ?? heightFn(start.x, start.y));
	const zEnd = (endZOverride ?? heightFn(end.x, end.y));

	function evalCenterZ(sChain: number): number {
		if (gradeProfile && gradeProfile.length >= 2) {
			// Ensure sorted by s
			const prof = [...gradeProfile].sort((a, b) => a.s - b.s);
			if (sChain <= prof[0].s) return prof[0].z;
			if (sChain >= prof[prof.length - 1].s) return prof[prof.length - 1].z;
			for (let i = 0; i < prof.length - 1; i++) {
				const a = prof[i];
				const b = prof[i + 1];
				if (sChain >= a.s && sChain <= b.s) {
					const tSeg = (sChain - a.s) / Math.max(1e-9, (b.s - a.s));
					return THREE.MathUtils.lerp(a.z, b.z, tSeg);
				}
			}
		}
		// Fallback to straight-line two-IP
		const t = totalLength > 0 ? sChain / totalLength : 0;
		return THREE.MathUtils.lerp(zStart, zEnd, t);
	}

	const laneW = template.laneWidth;
	const half = laneW;
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
		const zCenter = evalCenterZ(s);

		for (let j = 0; j < offsets.length; j++) {
			const o = offsets[j];
			const off = new THREE.Vector2(c.x + n2.x * o, c.y + n2.y * o);
			const sideSign = Math.sign(o) || 0;
			const slope = (Math.abs(o) <= laneW ? template.crossfallLane : template.crossfallLane) * sideSign;
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
		color: theme3D.roadSurface,
		metalness: 0.0,
		roughness: 1.0,
		side: THREE.DoubleSide,
		transparent: true,
		opacity: theme3D.roadSurfaceOpacity
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
	template: RoadTemplate,
	startZOverride?: number,
	endZOverride?: number,
	gradeProfile?: { s: number; z: number }[]
): THREE.LineSegments {
	if (centerline.length < 2) {
		return new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ visible: false }));
	}
	const chainages = computeChainages(centerline);
	const totalLength = chainages[chainages.length - 1] ?? 1;
	const start = centerline[0];
	const end = centerline[centerline.length - 1];
	const zStart = (startZOverride ?? heightFn(start.x, start.y));
	const zEnd = (endZOverride ?? heightFn(end.x, end.y));

	function evalCenterZ(sChain: number): number {
		if (gradeProfile && gradeProfile.length >= 2) {
			const prof = [...gradeProfile].sort((a, b) => a.s - b.s);
			if (sChain <= prof[0].s) return prof[0].z;
			if (sChain >= prof[prof.length - 1].s) return prof[prof.length - 1].z;
			for (let i = 0; i < prof.length - 1; i++) {
				const a = prof[i];
				const b = prof[i + 1];
				if (sChain >= a.s && sChain <= b.s) {
					const tSeg = (sChain - a.s) / Math.max(1e-9, (b.s - a.s));
					return THREE.MathUtils.lerp(a.z, b.z, tSeg);
				}
			}
		}
		const t = totalLength > 0 ? sChain / totalLength : 0;
		return THREE.MathUtils.lerp(zStart, zEnd, t);
	}

	const laneW = template.laneWidth;
	const half = laneW;

	const segments: number[] = [];
	for (let i = 0; i < centerline.length; i++) {
		const c = centerline[i];
		const prev = centerline[Math.max(0, i - 1)];
		const next = centerline[Math.min(centerline.length - 1, i + 1)];
		const tan2 = new THREE.Vector2().subVectors(next, prev).normalize();
		const n2 = new THREE.Vector2(-tan2.y, tan2.x).normalize();
		const s = chainages[i];
		const zCenter = evalCenterZ(s);
		const zLOuter = zCenter + (template.crossfallLane * -1) * -half; // left side sign = -1
		const zROuter = zCenter + (template.crossfallLane * +1) * +half; // right side sign = +1
		const lOuter = new THREE.Vector3(c.x + n2.x * -half, c.y + n2.y * -half, zLOuter);
		const rOuter = new THREE.Vector3(c.x + n2.x * +half, c.y + n2.y * +half, zROuter);
		segments.push(lOuter.x, lOuter.y, lOuter.z, rOuter.x, rOuter.y, rOuter.z);
	}

	const geom = new THREE.BufferGeometry();
	geom.setAttribute('position', new THREE.Float32BufferAttribute(segments, 3));
	const mat = new THREE.LineBasicMaterial({ color: theme3D.roadEdges });
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
	slopeHtoV = 2,
	startZOverride?: number,
	endZOverride?: number,
	gradeProfile?: { s: number; z: number }[]
): THREE.Mesh {
	if (centerline.length < 2) {
		return new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ visible: false }));
	}
	const chainages = computeChainages(centerline);
	const totalLength = chainages[chainages.length - 1] ?? 1;
	const start = centerline[0];
	const end = centerline[centerline.length - 1];
	const zStart = (startZOverride ?? heightFn(start.x, start.y));
	const zEnd = (endZOverride ?? heightFn(end.x, end.y));

	function evalCenterZ(sChain: number): number {
		if (gradeProfile && gradeProfile.length >= 2) {
			const prof = [...gradeProfile].sort((a, b) => a.s - b.s);
			if (sChain <= prof[0].s) return prof[0].z;
			if (sChain >= prof[prof.length - 1].s) return prof[prof.length - 1].z;
			for (let i = 0; i < prof.length - 1; i++) {
				const a = prof[i];
				const b = prof[i + 1];
				if (sChain >= a.s && sChain <= b.s) {
					const tSeg = (sChain - a.s) / Math.max(1e-9, (b.s - a.s));
					return THREE.MathUtils.lerp(a.z, b.z, tSeg);
				}
			}
		}
		const t = totalLength > 0 ? sChain / totalLength : 0;
		return THREE.MathUtils.lerp(zStart, zEnd, t);
	}

	const laneW = template.laneWidth;
	const half = laneW;
	const kerbEnabled = template.components?.kerb?.enabled !== false;
	const footEnabled = template.components?.footpath?.enabled !== false;
	const kerbW = template.components?.kerb?.width ?? template.kerbWidth ?? 0.25;
	const kerbH = template.components?.kerb?.height ?? template.kerbHeight ?? 0.125;
	const footW = template.components?.footpath?.width ?? template.footpathWidth ?? 1.5;
	const xfallFoot = template.components?.footpath?.crossfall ?? template.crossfallFootpath ?? -0.02;

	const positions: number[] = [];
	const indices: number[] = [];

	for (let i = 0; i < centerline.length; i++) {
		const c = centerline[i];
		const prev = centerline[Math.max(0, i - 1)];
		const next = centerline[Math.min(centerline.length - 1, i + 1)];
		const tan2 = new THREE.Vector2().subVectors(next, prev).normalize();
		const n2 = new THREE.Vector2(-tan2.y, tan2.x).normalize();
		const s = chainages[i];
		const zCenter = evalCenterZ(s);

		// Daylighting starts from OUTER edge of last enabled component on each side
		const oPavL = -half;
		const oPavR = +half;
		const zPavL = zCenter + (template.crossfallLane * Math.sign(oPavL)) * oPavL;
		const zPavR = zCenter + (template.crossfallLane * Math.sign(oPavR)) * oPavR;
		const zKerbTopL = zPavL + (kerbEnabled ? kerbH : 0);
		const zKerbTopR = zPavR + (kerbEnabled ? kerbH : 0);
		const oLastL = footEnabled ? -(half + kerbW + footW) : (kerbEnabled ? -(half + kerbW) : -half);
		const oLastR = footEnabled ? +(half + kerbW + footW) : (kerbEnabled ? +(half + kerbW) : +half);
		const leftEdgeXY = new THREE.Vector2(c.x + n2.x * oLastL, c.y + n2.y * oLastL);
		const rightEdgeXY = new THREE.Vector2(c.x + n2.x * oLastR, c.y + n2.y * oLastR);
		const zLeftEdge = footEnabled ? (zKerbTopL + (xfallFoot * -1) * footW) : (kerbEnabled ? zKerbTopL : zPavL);
		const zRightEdge = footEnabled ? (zKerbTopR + (xfallFoot * +1) * footW) : (kerbEnabled ? zKerbTopR : zPavR);

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
		color: theme3D.daylight,
		metalness: 0.0,
		roughness: 1.0,
		side: THREE.DoubleSide,
		transparent: true,
		opacity: theme3D.daylightOpacity
	});

	const mesh = new THREE.Mesh(geometry, material);
	mesh.renderOrder = 2.5;
	return mesh;
}

// --- New corridor builder: closed swept shapes and top strings ---
export function createCorridorFromTwoIPs(
	centerline: readonly THREE.Vector2[],
	heightFn: HeightFunction,
	template: RoadTemplate,
	startZOverride?: number,
	endZOverride?: number,
	gradeProfile?: { s: number; z: number }[]
): THREE.Group {
	const group = new THREE.Group();
	group.renderOrder = 3;
	if (centerline.length < 2) return group;

	const chainages = computeChainages(centerline);
	const totalLength = chainages[chainages.length - 1] ?? 1;
	const start = centerline[0];
	const end = centerline[centerline.length - 1];
	const zStart = (startZOverride ?? heightFn(start.x, start.y));
	const zEnd = (endZOverride ?? heightFn(end.x, end.y));

	function evalCenterZ(sChain: number): number {
		if (gradeProfile && gradeProfile.length >= 2) {
			const prof = [...gradeProfile].sort((a, b) => a.s - b.s);
			if (sChain <= prof[0].s) return prof[0].z;
			if (sChain >= prof[prof.length - 1].s) return prof[prof.length - 1].z;
			for (let i = 0; i < prof.length - 1; i++) {
				const a = prof[i];
				const b = prof[i + 1];
				if (sChain >= a.s && sChain <= b.s) {
					const tSeg = (sChain - a.s) / Math.max(1e-9, (b.s - a.s));
					return THREE.MathUtils.lerp(a.z, b.z, tSeg);
				}
			}
		}
		const t = totalLength > 0 ? sChain / totalLength : 0;
		return THREE.MathUtils.lerp(zStart, zEnd, t);
	}

	const laneW = template.laneWidth;
	const halfPav = laneW; // pavement half-width to kerb inner
	const pavEnabled = template.components?.pavement?.enabled !== false;
	const kerbEnabled = template.components?.kerb?.enabled !== false;
	const footEnabled = template.components?.footpath?.enabled !== false;
	const pavThk = template.components?.pavement?.thickness ?? template.pavementThickness ?? 0.30;
	const kerbW = template.components?.kerb?.width ?? template.kerbWidth ?? 0.25;
	const kerbH = template.components?.kerb?.height ?? template.kerbHeight ?? 0.125;
	const footW = template.components?.footpath?.width ?? template.footpathWidth ?? 1.5;
	const footThk = template.components?.footpath?.thickness ?? template.footpathThickness ?? 0.20;
	const xfallFoot = template.components?.footpath?.crossfall ?? template.crossfallFootpath ?? -0.02; // fall away from carriageway

	// Helper to get normal at row i
	function rowBasis(i: number): { c: THREE.Vector2; n: THREE.Vector2; s: number; zc: number } {
		const c = centerline[i];
		const prev = centerline[Math.max(0, i - 1)];
		const next = centerline[Math.min(centerline.length - 1, i + 1)];
		const tan2 = new THREE.Vector2().subVectors(next, prev).normalize();
		const n = new THREE.Vector2(-tan2.y, tan2.x).normalize();
		const s = chainages[i];
		const zc = evalCenterZ(s);
		return { c, n, s, zc };
	}

	function slopeAt(offset: number): number {
		const sideSign = Math.sign(offset) || 0;
		return (Math.abs(offset) <= laneW ? template.crossfallLane : template.crossfallLane) * sideSign;
	}

	function toHexColorNumber(color: string | number | undefined, fallback: number): number {
		if (typeof color === 'number') return color;
		if (typeof color === 'string') { try { return new THREE.Color(color).getHex(); } catch { return fallback; } }
		return fallback;
	}

	// Generic closed strip mesh builder given offsets array and per-row top Z values
	function buildClosedStrip(
		name: string,
		offsets: number[],
		evalTopZAtRow: (i: number, offsets: number[]) => number[],
		thickness: number,
		color: number
	): THREE.Mesh {
		const rows = centerline.length;
		const cols = offsets.length;
		const positionsTop: number[] = [];
		for (let i = 0; i < rows; i++) {
			const { c, n } = rowBasis(i);
			const zTop = evalTopZAtRow(i, offsets);
			for (let j = 0; j < cols; j++) {
				const o = offsets[j];
				const x = c.x + n.x * o;
				const y = c.y + n.y * o;
				const z = zTop[j];
				positionsTop.push(x, y, z);
			}
		}
		// Duplicate bottom
		const positions: number[] = [];
		positions.push(...positionsTop);
		for (let k = 0; k < positionsTop.length; k += 3) {
			positions.push(positionsTop[k], positionsTop[k + 1], positionsTop[k + 2] - thickness);
		}
		const indices: number[] = [];
		const topOffset = 0;
		const botOffset = rows * cols;
		// Top faces
		for (let r = 0; r < rows - 1; r++) {
			for (let cIdx = 0; cIdx < cols - 1; cIdx++) {
				const i0 = topOffset + r * cols + cIdx;
				const i1 = i0 + 1;
				const i2 = i0 + cols;
				const i3 = i2 + 1;
				indices.push(i0, i2, i1);
				indices.push(i1, i2, i3);
			}
		}
		// Bottom faces (flip winding)
		for (let r = 0; r < rows - 1; r++) {
			for (let cIdx = 0; cIdx < cols - 1; cIdx++) {
				const i0 = botOffset + r * cols + cIdx;
				const i1 = i0 + 1;
				const i2 = i0 + cols;
				const i3 = i2 + 1;
				indices.push(i0, i1, i2);
				indices.push(i1, i3, i2);
			}
		}
		// Side walls: left column (0) and right column (cols-1)
		function side(indicesOut: number[], col: number, topBase: number, bottomBase: number) {
			for (let r = 0; r < rows - 1; r++) {
				const t0 = topBase + r * cols + col;
				const t1 = t0 + cols;
				const b0 = bottomBase + r * cols + col;
				const b1 = b0 + cols;
				// quad t0-t1-b0 and t1-b1-b0 (choose winding for outward normal approximately)
				indicesOut.push(t0, b0, t1);
				indicesOut.push(t1, b0, b1);
			}
		}
		side(indices, 0, topOffset, botOffset);
		side(indices, cols - 1, topOffset, botOffset);

		const geometry = new THREE.BufferGeometry();
		geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
		geometry.setIndex(indices);
		geometry.computeVertexNormals();
		const material = new THREE.MeshStandardMaterial({ color, roughness: 0.95, metalness: 0.0, side: THREE.DoubleSide, transparent: true, opacity: 0.9 });
		const mesh = new THREE.Mesh(geometry, material);
		(mesh as any).name = name;
		return mesh;
	}

	// Pavement closed strip
	const offsetsPav = [-halfPav, -laneW, 0, laneW, halfPav];
	const pavementTop = (i: number, offs: number[]) => offs.map(o => {
		const { zc } = rowBasis(i);
		return zc + slopeAt(o) * o;
	});
	if (pavEnabled) {
		const pavColor = toHexColorNumber(template.components?.pavement?.color, 0x7cb342);
		const pavementMesh = buildClosedStrip('pavement', offsetsPav, pavementTop, pavThk, pavColor);
		group.add(pavementMesh);
	}

	// Kerb per side closed strip
	function kerbTop(i: number, offs: number[], sideSign: number): number[] {
		const { zc } = rowBasis(i);
		const oInner = sideSign * halfPav;
		const zInner = zc + slopeAt(oInner) * oInner;
		const zOuterTop = zInner + kerbH;
		return [zInner, zOuterTop];
	}
	const offsetsKerbLeft = [-halfPav, -(halfPav + kerbW)];
	const offsetsKerbRight = [halfPav, (halfPav + kerbW)];
	if (kerbEnabled) {
		const kerbColor = toHexColorNumber(template.components?.kerb?.color, 0xffd54f);
		const kerbLeftMesh = buildClosedStrip('kerbL', offsetsKerbLeft, (i, o) => kerbTop(i, o, -1), Math.max(pavThk, footThk), kerbColor);
		const kerbRightMesh = buildClosedStrip('kerbR', offsetsKerbRight, (i, o) => kerbTop(i, o, +1), Math.max(pavThk, footThk), kerbColor);
		group.add(kerbLeftMesh);
		group.add(kerbRightMesh);
	}

	// Footpath per side closed strip
	function footTop(i: number, sideSign: number): { zInner: number; zOuter: number } {
		const { zc } = rowBasis(i);
		const oKerbInner = sideSign * halfPav;
		const zPavEdge = zc + slopeAt(oKerbInner) * oKerbInner;
		const zKerbTop = zPavEdge + kerbH;
		const zOuter = zKerbTop + (xfallFoot * sideSign) * footW;
		return { zInner: zKerbTop, zOuter };
	}
	const offsetsFootLeft = [-(halfPav + kerbW), -(halfPav + kerbW + footW)];
	const offsetsFootRight = [(halfPav + kerbW), (halfPav + kerbW + footW)];
	if (footEnabled) {
		const footColor = toHexColorNumber(template.components?.footpath?.color, 0x64b5f6);
		const footLeftMesh = buildClosedStrip('footpathL', offsetsFootLeft, (i, _o) => {
			const f = footTop(i, -1);
			return [f.zInner, f.zOuter];
		}, footThk, footColor);
		const footRightMesh = buildClosedStrip('footpathR', offsetsFootRight, (i, _o) => {
			const f = footTop(i, +1);
			return [f.zInner, f.zOuter];
		}, footThk, footColor);
		group.add(footLeftMesh);
		group.add(footRightMesh);
	}

	// Top surface strings (as 3D polylines)
	function buildString(points: THREE.Vector3[], color: number, name: string): THREE.Line {
		const geom = new THREE.BufferGeometry().setFromPoints(points);
		const mat = new THREE.LineBasicMaterial({ color, linewidth: 2 });
		const line = new THREE.Line(geom, mat);
		(line as any).name = name;
		line.renderOrder = 5;
		return line;
	}
	const pavEdgeL: THREE.Vector3[] = [], pavEdgeR: THREE.Vector3[] = [];
	const kerbTopL: THREE.Vector3[] = [], kerbTopR: THREE.Vector3[] = [];
	const footOutL: THREE.Vector3[] = [], footOutR: THREE.Vector3[] = [];
	for (let i = 0; i < centerline.length; i++) {
		const { c, n, zc } = rowBasis(i);
		const oPavL = -halfPav, oPavR = +halfPav;
		const zPavL = zc + slopeAt(oPavL) * oPavL;
		const zPavR = zc + slopeAt(oPavR) * oPavR;
		const oKerbOutL = -(halfPav + kerbW);
		const oKerbOutR = +(halfPav + kerbW);
		const zKerbTopL = zPavL + kerbH;
		const zKerbTopR = zPavR + kerbH;
		const oFootOutL = -(halfPav + kerbW + footW);
		const oFootOutR = +(halfPav + kerbW + footW);
		const zFootOutL = zKerbTopL + (xfallFoot * -1) * footW;
		const zFootOutR = zKerbTopR + (xfallFoot * +1) * footW;
		pavEdgeL.push(new THREE.Vector3(c.x + n.x * oPavL, c.y + n.y * oPavL, zPavL));
		pavEdgeR.push(new THREE.Vector3(c.x + n.x * oPavR, c.y + n.y * oPavR, zPavR));
		if (kerbEnabled) {
			kerbTopL.push(new THREE.Vector3(c.x + n.x * oKerbOutL, c.y + n.y * oKerbOutL, zKerbTopL));
			kerbTopR.push(new THREE.Vector3(c.x + n.x * oKerbOutR, c.y + n.y * oKerbOutR, zKerbTopR));
		}
		if (footEnabled) {
			footOutL.push(new THREE.Vector3(c.x + n.x * oFootOutL, c.y + n.y * oFootOutL, zFootOutL));
			footOutR.push(new THREE.Vector3(c.x + n.x * oFootOutR, c.y + n.y * oFootOutR, zFootOutR));
		}
	}
	group.add(buildString(pavEdgeL, 0xff8a80, 'stringPavEdgeL'));
	group.add(buildString(pavEdgeR, 0xff8a80, 'stringPavEdgeR'));
	if (kerbEnabled) {
		group.add(buildString(kerbTopL, 0xff8a80, 'stringKerbTopL'));
		group.add(buildString(kerbTopR, 0xff8a80, 'stringKerbTopR'));
	}
	if (footEnabled) {
		group.add(buildString(footOutL, 0xff8a80, 'stringFootOutL'));
		group.add(buildString(footOutR, 0xff8a80, 'stringFootOutR'));
	}

	return group;
}


