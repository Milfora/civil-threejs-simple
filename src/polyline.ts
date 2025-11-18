import * as THREE from 'three';
import type { HeightFunction } from './surface';

export class DrapedPolyline {
	private readonly xyPoints: THREE.Vector2[] = [];
	private readonly line: THREE.Line;
	private readonly sampleStep: number;
	private readonly heightFn: HeightFunction;

	constructor(heightFn: HeightFunction, sampleStep = 1.0) {
		this.heightFn = heightFn;
		this.sampleStep = Math.max(0.1, sampleStep);
		const mat = new THREE.LineBasicMaterial({ color: 0x000000, linewidth: 2 });
		const geom = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
		this.line = new THREE.Line(geom, mat);
		this.line.renderOrder = 4;
	}

	public addPoint(xy: THREE.Vector2): void {
		this.xyPoints.push(xy.clone());
		this.rebuildGeometry(); // live update for feedback
	}

	public finalize(): void {
		this.rebuildGeometry();
	}

	public getLineObject(): THREE.Line {
		return this.line;
	}

	public getControlPointCount(): number {
		return this.xyPoints.length;
	}

	public getControlPoints(): THREE.Vector2[] {
		return this.xyPoints.map(p => p.clone());
	}

	public moveControlPoint(index: number, xy: THREE.Vector2): void {
		if (index < 0 || index >= this.xyPoints.length) return;
		this.xyPoints[index] = xy.clone();
		this.rebuildGeometry();
	}

	public getSampledPoints3D(): THREE.Vector3[] {
		const pts: THREE.Vector3[] = [];
		this.sampleAlong((x, y) => {
			const z = this.heightFn(x, y);
			pts.push(new THREE.Vector3(x, y, z));
		});
		return pts;
	}

	private rebuildGeometry(): void {
		if (this.xyPoints.length < 2) {
			const single = this.xyPoints[0];
			const pts = single ? [new THREE.Vector3(single.x, single.y, this.heightFn(single.x, single.y))] : [new THREE.Vector3(0, 0, 0)];
			const geom = new THREE.BufferGeometry().setFromPoints(pts);
			this.disposeGeometry();
			(this.line as any).geometry = geom;
			return;
		}
		const verts: number[] = [];
		this.sampleAlong((x, y) => {
			const z = this.heightFn(x, y);
			verts.push(x, y, z);
		});
		const geom = new THREE.BufferGeometry();
		geom.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
		this.disposeGeometry();
		(this.line as any).geometry = geom;
	}

	private sampleAlong(emit: (x: number, y: number) => void): void {
		if (this.xyPoints.length === 0) return;
		emit(this.xyPoints[0].x, this.xyPoints[0].y);
		for (let i = 1; i < this.xyPoints.length; i++) {
			const a = this.xyPoints[i - 1];
			const b = this.xyPoints[i];
			const dx = b.x - a.x;
			const dy = b.y - a.y;
			const len = Math.hypot(dx, dy);
			if (len <= 1e-6) continue;
			const steps = Math.max(1, Math.ceil(len / this.sampleStep));
			for (let s = 1; s <= steps; s++) {
				const t = s / steps;
				const x = a.x + dx * t;
				const y = a.y + dy * t;
				emit(x, y);
			}
		}
	}

	private disposeGeometry(): void {
		const g = this.line.geometry as THREE.BufferGeometry | undefined;
		if (g) g.dispose();
	}
}


