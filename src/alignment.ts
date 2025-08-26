import * as THREE from 'three';
import { theme3D } from './theme';

export interface ClosestPointResult {
	point: THREE.Vector2;
	tangent: THREE.Vector2;
	segmentIndex: number;
	chainage: number;
	distance: number;
}

export class Alignment {
	public readonly object3d: THREE.Line;
	private readonly points: THREE.Vector2[];
	private cumulative: number[];
	private ips: THREE.Vector2[];
	private cornerRadii: (number | undefined)[];
	private defaultFilletRadius: number;
	private lineStep: number;
	private arcStep: number;

	constructor() {
		// Build default alignment using IP method (filleted polyline)
		const p0 = new THREE.Vector2(-20, -5);
		// const p1 = new THREE.Vector2(0, -5);
		// const p2 = new THREE.Vector2(10, 5);
		const p1 = new THREE.Vector2(10, -5);
		const p2 = new THREE.Vector2(10, 25);

		const defaultRadius = 10;
		const step = 1.0;
		const arcStep = 1.0;

		// const built = buildFilletedPolylineFromIPs([p0, p1, p2, p3], defaultRadius, step, arcStep);
		this.cornerRadii = [];
		const built = buildFilletedPolylineFromIPs([p0, p1, p2], defaultRadius, step, arcStep, this.cornerRadii);

		this.points = dedupe(built);
		this.cumulative = cumulativeDistances(this.points);
		this.ips = [p0.clone(), p1.clone(), p2.clone()];
		this.defaultFilletRadius = defaultRadius;
		this.lineStep = step;
		this.arcStep = arcStep;

		// Build a single continuous line object in XY at Z=0
		const verts = this.points.map(v => new THREE.Vector3(v.x, v.y, 0));
		const geometry = new THREE.BufferGeometry().setFromPoints(verts);
		const material = new THREE.LineBasicMaterial({ color: theme3D.alignment, linewidth: 1 });
		this.object3d = new THREE.Line(geometry, material);
		this.object3d.renderOrder = 2;
	}

	public setPolyline(newPoints: THREE.Vector2[]) {
		const pts = dedupe(newPoints);
		if (pts.length < 2) return;
		// update points in place to preserve reference
		(this.points as THREE.Vector2[]).length = 0;
		for (const p of pts) (this.points as THREE.Vector2[]).push(p.clone());
		this.cumulative = cumulativeDistances(this.points);
		// update geometry buffer
		const verts = this.points.map(v => new THREE.Vector3(v.x, v.y, 0));
		const geom = new THREE.BufferGeometry().setFromPoints(verts);
		this.object3d.geometry.dispose();
		// swap geometry
		(this.object3d as any).geometry = geom;
	}

	public buildFromIPs(ips: readonly THREE.Vector2[], defaultRadius = 10, step = 1.0, arcStep = 1.0) {
		this.ips = ips.map(p => p.clone());
		this.ensureCornerRadiiLength();
		this.defaultFilletRadius = defaultRadius;
		this.lineStep = step;
		this.arcStep = arcStep;
		const built = buildFilletedPolylineFromIPs(this.ips, this.defaultFilletRadius, this.lineStep, this.arcStep, this.cornerRadii);
		if (built.length >= 2) this.setPolyline(built);
	}

	public getIPs(): readonly THREE.Vector2[] { return this.ips; }

	public setIPs(ips: readonly THREE.Vector2[]) {
		this.ips = ips.map(p => p.clone());
		this.ensureCornerRadiiLength();
		this.buildFromIPs(ips, this.defaultFilletRadius, this.lineStep, this.arcStep);
	}

	public getDefaultRadius(): number { return this.defaultFilletRadius; }

	public setDefaultRadius(r: number) {
		const newR = Math.max(1e-6, r);
		this.defaultFilletRadius = newR;
		const built = buildFilletedPolylineFromIPs(this.ips, this.defaultFilletRadius, this.lineStep, this.arcStep, this.cornerRadii);
		if (built.length >= 2) this.setPolyline(built);
	}

	public moveIP(index: number, newPos: THREE.Vector2) {
		if (index < 0 || index >= this.ips.length) return;
		(this.ips[index] as THREE.Vector2).copy(newPos);
		const built = buildFilletedPolylineFromIPs(this.ips, this.defaultFilletRadius, this.lineStep, this.arcStep, this.cornerRadii);
		if (built.length >= 2) this.setPolyline(built);
	}

	private ensureCornerRadiiLength() {
		const n = this.ips.length;
		const old = this.cornerRadii ?? [];
		const next: (number | undefined)[] = new Array(n).fill(undefined);
		const copy = Math.min(old.length, n);
		for (let i = 1; i < copy - 1; i++) next[i] = old[i];
		this.cornerRadii = next;
	}

	public getCornerRadius(index: number): number | undefined {
		if (index <= 0 || index >= this.ips.length - 1) return undefined;
		return this.cornerRadii[index];
	}

	public setCornerRadius(index: number, radius?: number) {
		if (index <= 0 || index >= this.ips.length - 1) return;
		this.cornerRadii[index] = radius !== undefined ? Math.max(1e-6, radius) : undefined;
		const built = buildFilletedPolylineFromIPs(this.ips, this.defaultFilletRadius, this.lineStep, this.arcStep, this.cornerRadii);
		if (built.length >= 2) this.setPolyline(built);
	}

	public getNearestCornerIndexTo(x: number, y: number): number | null {
		if (this.ips.length < 3) return null;
		const q = new THREE.Vector2(x, y);
		let best = Number.POSITIVE_INFINITY;
		let bestIdx = -1;
		for (let i = 1; i <= this.ips.length - 2; i++) {
			const d = q.distanceTo(this.ips[i]);
			if (d < best) { best = d; bestIdx = i; }
		}
		return bestIdx >= 1 ? bestIdx : null;
	}

	public length(): number {
		return this.cumulative[this.cumulative.length - 1] ?? 0;
	}

	public getPoints(): readonly THREE.Vector2[] {
		return this.points;
	}

	public closestPointTo(x: number, y: number): ClosestPointResult {
		const q = new THREE.Vector2(x, y);
		let bestDist = Number.POSITIVE_INFINITY;
		let bestPoint = new THREE.Vector2();
		let bestTangent = new THREE.Vector2(1, 0);
		let bestSeg = 0;
		let bestChain = 0;

		for (let i = 0; i < this.points.length - 1; i++) {
			const a = this.points[i];
			const b = this.points[i + 1];
			const ab = new THREE.Vector2().subVectors(b, a);
			const abLen2 = Math.max(1e-12, ab.lengthSq());
			const t = THREE.MathUtils.clamp(new THREE.Vector2().subVectors(q, a).dot(ab) / abLen2, 0, 1);
			const p = new THREE.Vector2(a.x + ab.x * t, a.y + ab.y * t);
			const d = p.distanceTo(q);
			if (d < bestDist) {
				bestDist = d;
				bestPoint.copy(p);
				bestTangent.copy(ab.normalize());
				bestSeg = i;
				const segStartChain = this.cumulative[i];
				const segLen = Math.sqrt(abLen2);
				bestChain = segStartChain + segLen * t;
			}
		}

		return {
			point: bestPoint,
			tangent: bestTangent,
			segmentIndex: bestSeg,
			chainage: bestChain,
			distance: bestDist
		};
	}
}

function sampleLine(out: THREE.Vector2[], a: THREE.Vector2, b: THREE.Vector2, step: number) {
	const ab = new THREE.Vector2().subVectors(b, a);
	const len = ab.length();
	const n = Math.max(2, Math.ceil(len / step));
	for (let i = 0; i < n; i++) {
		const t = i / (n - 1);
		out.push(new THREE.Vector2(a.x + ab.x * t, a.y + ab.y * t));
	}
}

function sampleArc(out: THREE.Vector2[], center: THREE.Vector2, radius: number, a0: number, a1: number, samples: number) {
	for (let i = 0; i < samples; i++) {
		const t = i / (samples - 1);
		const a = THREE.MathUtils.lerp(a0, a1, t);
		out.push(new THREE.Vector2(center.x + radius * Math.cos(a), center.y + radius * Math.sin(a)));
	}
}

function dedupe(pts: THREE.Vector2[]): THREE.Vector2[] {
	const out: THREE.Vector2[] = [];
	for (let i = 0; i < pts.length; i++) {
		if (i === 0 || !pts[i].equals(pts[i - 1])) out.push(pts[i].clone());
	}
	return out;
}

function cumulativeDistances(pts: THREE.Vector2[]): number[] {
	const cum: number[] = [0];
	for (let i = 1; i < pts.length; i++) {
		const d = pts[i].distanceTo(pts[i - 1]);
		cum.push(cum[i - 1] + d);
	}
	return cum;
}


// Build a filleted centerline from IPs with circular arcs (G1 continuity)
export function buildFilletedPolylineFromIPs(
	ips: readonly THREE.Vector2[],
	radius: number,
	lineStep = 1.0,
	arcStep = 1.0,
	radiiPerCorner?: (number | undefined)[]
): THREE.Vector2[] {
	const n = ips.length;
	if (n === 0) return [];
	if (n === 1) return [ips[0].clone()];
	if (n === 2) {
		const out: THREE.Vector2[] = [];
		// keep existing sampler, then dedupe to be safe
		sampleLine(out, ips[0], ips[1], lineStep);
		return dedupe(out);
	}

	type Corner = {
		T1: THREE.Vector2;
		T2: THREE.Vector2;
		center: THREE.Vector2;
		R: number;
		ccw: boolean;
	} | null;

	const corners: (Corner)[] = new Array(n).fill(null);

	for (let i = 1; i <= n - 2; i++) {
		const A = ips[i - 1];
		const B = ips[i];
		const C = ips[i + 1];

		const dIn = new THREE.Vector2().subVectors(B, A).normalize();
		const dOut = new THREE.Vector2().subVectors(C, B).normalize();

		const turn = dIn.x * dOut.y - dIn.y * dOut.x; // >0 left, <0 right
		const cosTheta = THREE.MathUtils.clamp(dIn.dot(dOut), -1, 1);
		const theta = Math.acos(cosTheta); // interior angle 0..pi

		// Skip nearly straight or nearly U-turn
		if (!(theta > 1e-3 && theta < Math.PI - 1e-3)) { corners[i] = null; continue; }

		const lenIn = A.distanceTo(B);
		const lenOut = B.distanceTo(C);
		const tanHalf = Math.tan(theta / 2);
		if (Math.abs(tanHalf) < 1e-9) { corners[i] = null; continue; }

		const Rcorner = (radiiPerCorner && radiiPerCorner[i] !== undefined) ? (radiiPerCorner[i] as number) : radius;
		let Ruse = Math.max(1e-6, Rcorner);
		const tNeeded = Ruse * tanHalf;
		const tMax = Math.max(0, Math.min(lenIn, lenOut) - 1e-6);
		if (tNeeded > tMax) {
			Ruse = tMax / tanHalf;
			if (!Number.isFinite(Ruse) || Ruse <= 1e-6) { corners[i] = null; continue; }
		}

		// Inside normals via turn sign
		const s = Math.sign(turn) || 1;
		const nIn = rotate90(dIn).multiplyScalar(s);
		const nOut = rotate90(dOut).multiplyScalar(s);

		// Offset incoming/outgoing lines by Ruse toward inside and intersect to get centre
		const p1 = new THREE.Vector2().copy(B).add(nIn.clone().multiplyScalar(Ruse));
		const p2 = new THREE.Vector2().copy(B).add(nOut.clone().multiplyScalar(Ruse));
		const center = intersectLines(p1, dIn, p2, dOut);
		if (!center) { corners[i] = null; continue; }

		// Tangency points: exactly perpendicular to legs
		const T1 = new THREE.Vector2().copy(center).sub(nIn.clone().multiplyScalar(Ruse));
		const T2 = new THREE.Vector2().copy(center).sub(nOut.clone().multiplyScalar(Ruse));

		// Arc orientation
		const ccw = s > 0;

		corners[i] = { T1, T2, center, R: Ruse, ccw };
	}

	// Stitch segments with open straight segments and closed arcs
	const out: THREE.Vector2[] = [];
	for (let i = 0; i < n - 1; i++) {
		const P = ips[i];
		const Q = ips[i + 1];
		const leftCorner = i >= 1 ? corners[i] : null;
		const rightCorner = i + 1 <= n - 2 ? corners[i + 1] : null;

		const segStart = leftCorner ? leftCorner.T2 : P;
		const segEnd   = rightCorner ? rightCorner.T1 : Q;

		if (segStart.distanceTo(segEnd) > 1e-9) {
			sampleLineOpen(out, segStart, segEnd, lineStep); // exclude endpoint to avoid duplicates
		}

		if (rightCorner) {
			const { center: c, R, ccw, T1, T2 } = rightCorner;
			const a0 = Math.atan2(T1.y - c.y, T1.x - c.x);
			let a1 = Math.atan2(T2.y - c.y, T2.x - c.x);
			let start = a0, end = a1;
			if (ccw) {
				while (end < start) end += Math.PI * 2;
			} else {
				while (end > start) end -= Math.PI * 2;
			}
			const arcLen = Math.abs((end - start) * R);
			const samples = Math.max(2, Math.ceil(arcLen / Math.max(1e-6, arcStep)));
			sampleArcClosed(out, c, R, start, end, samples); // includes endpoint
		}
	}

	return dedupeEps(out);
}




// === Robust fillet helpers (added) ===
function rotate90(v: THREE.Vector2): THREE.Vector2 {
	return new THREE.Vector2(-v.y, v.x);
}

function intersectLines(p1: THREE.Vector2, d1: THREE.Vector2, p2: THREE.Vector2, d2: THREE.Vector2): THREE.Vector2 | null {
	// Solve p1 + t d1 = p2 + u d2
	const denom = d1.x * d2.y - d1.y * d2.x;
	if (Math.abs(denom) < 1e-12) return null; // parallel or near-parallel
	const dx = p2.x - p1.x, dy = p2.y - p1.y;
	const t = (dx * d2.y - dy * d2.x) / denom;
	return new THREE.Vector2(p1.x + d1.x * t, p1.y + d1.y * t);
}

function approxEqual(a: THREE.Vector2, b: THREE.Vector2, eps = 1e-9): boolean {
	return Math.abs(a.x - b.x) <= eps && Math.abs(a.y - b.y) <= eps;
}

function sampleLineOpen(out: THREE.Vector2[], a: THREE.Vector2, b: THREE.Vector2, step: number) {
	const ab = new THREE.Vector2().subVectors(b, a);
	const len = ab.length();
	const n = Math.max(2, Math.ceil(len / Math.max(1e-9, step)));
	for (let i = 0; i < n - 1; i++) { // exclude final endpoint
		const t = i / (n - 1);
		out.push(new THREE.Vector2(a.x + ab.x * t, a.y + ab.y * t));
	}
}

function sampleArcClosed(out: THREE.Vector2[], center: THREE.Vector2, radius: number, a0: number, a1: number, samples: number) {
	for (let i = 0; i < samples; i++) {
		const t = i / (samples - 1);
		const a = THREE.MathUtils.lerp(a0, a1, t);
		out.push(new THREE.Vector2(center.x + radius * Math.cos(a), center.y + radius * Math.sin(a)));
	}
}

function dedupeEps(pts: THREE.Vector2[], eps = 1e-9): THREE.Vector2[] {
	const out: THREE.Vector2[] = [];
	for (let i = 0; i < pts.length; i++) {
		if (i === 0 || !approxEqual(pts[i], pts[i - 1], eps)) out.push(pts[i].clone());
	}
	return out;
}
// === End robust helpers ===
