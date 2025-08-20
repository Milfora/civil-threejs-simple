import * as THREE from 'three';

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
	private readonly cumulative: number[];

	constructor() {
		// Create a simple alignment: line → arc → line; all in XY (Z=0)
		// Segment 1: line from (-20, -5) to (0, -5)
		const p0 = new THREE.Vector2(-20, -5);
		const p1 = new THREE.Vector2(0, -5);

		// Segment 2: arc of radius 10 centered at (0, 5), angles -90° to 0°
		const center = new THREE.Vector2(0, 5);
		const radius = 10;
		const a0 = -Math.PI / 2;
		const a1 = 0;
		const arcSamples = 64;

		// Segment 3: line from arc end (10,5) to (10, 25)
		const p2 = new THREE.Vector2(10, 5);
		const p3 = new THREE.Vector2(10, 25);

		const pts: THREE.Vector2[] = [];
		// Line 1
		sampleLine(pts, p0, p1, 1.0);
		// Arc (ccw)
		sampleArc(pts, center, radius, a0, a1, arcSamples);
		// Line 2
		sampleLine(pts, p2, p3, 1.0);

		this.points = dedupe(pts);
		this.cumulative = cumulativeDistances(this.points);

		// Build a single continuous line object in XY at Z=0
		const verts = this.points.map(v => new THREE.Vector3(v.x, v.y, 0));
		const geometry = new THREE.BufferGeometry().setFromPoints(verts);
		const material = new THREE.LineBasicMaterial({ color: 0xb7bdc4, linewidth: 1 });
		this.object3d = new THREE.Line(geometry, material);
		this.object3d.renderOrder = 2;
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


