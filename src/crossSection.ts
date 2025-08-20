import * as THREE from 'three';
import { HeightFunction } from './surface';

export interface SectionData {
	distances: number[]; // along normal, centered at 0
	elevations: number[]; // z values sampled from surface
	minZ: number;
	maxZ: number;
	centerZ: number; // elevation at alignment center (profile)
	halfWidth: number; // section half-width used for plotting
}

export class CrossSectionOverlay {
	private readonly container: HTMLDivElement;
	private readonly canvas: HTMLCanvasElement;
	private readonly ctx: CanvasRenderingContext2D;
	public active = false;
	private isDragging = false;
	private dragOffsetX = 0;
	private dragOffsetY = 0;

	constructor(containerId = 'overlay', canvasId = 'overlay-canvas') {
		const container = document.getElementById(containerId) as HTMLDivElement | null;
		const canvas = document.getElementById(canvasId) as HTMLCanvasElement | null;
		if (!container || !canvas) throw new Error('CrossSectionOverlay DOM not found');
		const ctx = canvas.getContext('2d');
		if (!ctx) throw new Error('2D context not available');

		this.container = container;
		this.canvas = canvas;
		this.ctx = ctx;

		this.setupDrag();
	}

	public setActive(on: boolean) {
		this.active = on;
		this.container.classList.toggle('hidden', !on);
	}

	private setupDrag() {
		const header = this.container.querySelector('.overlay-header') as HTMLDivElement | null;
		if (!header) return;

		header.addEventListener('mousedown', (e: MouseEvent) => {
			// Start dragging from header
			this.isDragging = true;
			const rect = this.container.getBoundingClientRect();
			this.dragOffsetX = e.clientX - rect.left;
			this.dragOffsetY = e.clientY - rect.top;
			e.preventDefault();
		});

		window.addEventListener('mousemove', (e: MouseEvent) => {
			if (!this.isDragging) return;
			const maxLeft = Math.max(0, window.innerWidth - this.container.clientWidth);
			const maxTop = Math.max(0, window.innerHeight - this.container.clientHeight);
			let left = e.clientX - this.dragOffsetX;
			let top = e.clientY - this.dragOffsetY;
			left = Math.min(Math.max(0, left), maxLeft);
			top = Math.min(Math.max(0, top), maxTop);
			this.container.style.left = `${left}px`;
			this.container.style.top = `${top}px`;
		});

		window.addEventListener('mouseup', () => {
			this.isDragging = false;
		});
	}

	public computeSection(
		centerXY: THREE.Vector2,
		perpDir: THREE.Vector2,
		halfWidth: number,
		samples: number,
		heightFn: HeightFunction
	): SectionData {
		const dir = perpDir.clone().normalize();
		const distances: number[] = [];
		const elevations: number[] = [];
		let minZ = Number.POSITIVE_INFINITY;
		let maxZ = Number.NEGATIVE_INFINITY;
		const centerZ = heightFn(centerXY.x, centerXY.y);

		for (let i = 0; i < samples; i++) {
			const t = i / (samples - 1);
			const s = -halfWidth + 2 * halfWidth * t; // [-halfWidth, +halfWidth]
			const x = centerXY.x + dir.x * s;
			const y = centerXY.y + dir.y * s;
			const z = heightFn(x, y);
			distances.push(s);
			elevations.push(z);
			if (z < minZ) minZ = z;
			if (z > maxZ) maxZ = z;
		}
		// Expand range slightly to avoid flat lines
		if (Math.abs(maxZ - minZ) < 1e-3) {
			maxZ += 0.5;
			minZ -= 0.5;
		}
		return { distances, elevations, minZ, maxZ, centerZ, halfWidth };
	}

	public draw(section: SectionData, title?: string) {
		// Fit canvas to CSS box each draw for crispness
		const w = this.container.clientWidth;
		const h = this.container.clientHeight - 32; // minus header
		if (w <= 0 || h <= 0) return;
		this.canvas.width = w;
		this.canvas.height = h;

		const ctx = this.ctx;
		ctx.clearRect(0, 0, w, h);

		// Padding
		const padL = 36, padR = 10, padT = 10, padB = 24;
		const plotW = Math.max(10, w - padL - padR);
		const plotH = Math.max(10, h - padT - padB);

		// Axes scales
		const minX = section.distances[0];
		const maxX = section.distances[section.distances.length - 1];
		const minY = section.minZ;
		const maxY = section.maxZ;
		const xToPx = (x: number) => padL + ((x - minX) / (maxX - minX)) * plotW;
		const yToPx = (y: number) => padT + (1 - (y - minY) / (maxY - minY)) * plotH;

		// Grid
		ctx.strokeStyle = '#2b2f3a';
		ctx.lineWidth = 1;
		ctx.beginPath();
		for (let i = 0; i <= 4; i++) {
			const y = padT + (i / 4) * plotH;
			ctx.moveTo(padL, y); ctx.lineTo(padL + plotW, y);
		}
		for (let i = 0; i <= 8; i++) {
			const x = padL + (i / 8) * plotW;
			ctx.moveTo(x, padT); ctx.lineTo(x, padT + plotH);
		}
		ctx.stroke();

		// Axes
		ctx.strokeStyle = '#aab0c0';
		ctx.lineWidth = 1.2;
		ctx.beginPath();
		ctx.rect(padL, padT, plotW, plotH);
		ctx.stroke();

		// Draw roadway template (design) centered at 0 offset using profile elevation
		this.drawRoadwayTemplate({
			ctx,
			xToPx,
			yToPx,
			padT,
			padL,
			plotH,
			plotW,
			minX,
			maxX,
			centerZ: section.centerZ
		});

		// Alignment offset line at x=0 (if in range)
		if (minX < 0 && maxX > 0) {
			const x0 = xToPx(0);
			ctx.strokeStyle = '#c7cbd1';
			ctx.lineWidth = 1.6;
			ctx.setLineDash([]);
			ctx.beginPath();
			ctx.moveTo(x0, padT);
			ctx.lineTo(x0, padT + plotH);
			ctx.stroke();
		}

		// Labels
		ctx.fillStyle = '#aab0c0';
		ctx.font = '11px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, Cantarell, Noto Sans';
		ctx.fillText(`${title ?? ''}`, padL + 6, padT + 14);
		ctx.fillText(`z [m]`, 6, padT + 12);
		ctx.fillText(`x⊥ [m]`, w - 42, h - 6);

		// Zero line if in range
		if (minY < 0 && maxY > 0) {
			const y0 = yToPx(0);
			ctx.strokeStyle = '#3b3f4a';
			ctx.setLineDash([4, 4]);
			ctx.beginPath();
			ctx.moveTo(padL, y0);
			ctx.lineTo(padL + plotW, y0);
			ctx.stroke();
			ctx.setLineDash([]);
		}

		// Polyline
		ctx.strokeStyle = '#ffd166';
		ctx.lineWidth = 2;
		ctx.beginPath();
		for (let i = 0; i < section.distances.length; i++) {
			const x = xToPx(section.distances[i]);
			const y = yToPx(section.elevations[i]);
			if (i === 0) ctx.moveTo(x, y);
			else ctx.lineTo(x, y);
		}
		ctx.stroke();
	}

	private drawRoadwayTemplate(args: {
		ctx: CanvasRenderingContext2D;
		xToPx: (x: number) => number;
		yToPx: (y: number) => number;
		padT: number;
		padL: number;
		plotH: number;
		plotW: number;
		minX: number;
		maxX: number;
		centerZ: number;
	}) {
		const { ctx, xToPx, yToPx, centerZ } = args;
		// Simple symmetric crown template: lane + shoulder per side, different crossfalls
		const LANE_WIDTH = 3.5;
		const SHOULDER_WIDTH = 1.0;
		const HALF_TEMPLATE = LANE_WIDTH + SHOULDER_WIDTH; // 4.5 m
		const SLOPE_L = +0.02; // left side up-slope sign (+) with negative offset yields drop away from center
		const SLOPE_R = -0.02; // right side
		const SLOPE_SH_L = +0.04;
		const SLOPE_SH_R = -0.04;

		// Offsets: [left outer, left lane edge, center, right lane edge, right outer]
		const oLOuter = -HALF_TEMPLATE;
		const oLLane = -LANE_WIDTH;
		const oCenter = 0;
		const oRLane = +LANE_WIDTH;
		const oROuter = +HALF_TEMPLATE;

		const zLOuter = centerZ + SLOPE_SH_L * oLOuter;
		const zLLane = centerZ + SLOPE_L * oLLane;
		const zCenter = centerZ;
		const zRLane = centerZ + SLOPE_R * oRLane;
		const zROuter = centerZ + SLOPE_SH_R * oROuter;

		// Filled polygon
		ctx.fillStyle = 'rgba(180, 190, 200, 0.14)';
		ctx.beginPath();
		ctx.moveTo(xToPx(oLOuter), yToPx(zLOuter));
		ctx.lineTo(xToPx(oLLane), yToPx(zLLane));
		ctx.lineTo(xToPx(oCenter), yToPx(zCenter));
		ctx.lineTo(xToPx(oRLane), yToPx(zRLane));
		ctx.lineTo(xToPx(oROuter), yToPx(zROuter));
		ctx.closePath();
		ctx.fill();

		// Edges
		ctx.strokeStyle = '#9aa3ad';
		ctx.lineWidth = 1.6;
		ctx.beginPath();
		ctx.moveTo(xToPx(oLOuter), yToPx(zLOuter));
		ctx.lineTo(xToPx(oLLane), yToPx(zLLane));
		ctx.lineTo(xToPx(oCenter), yToPx(zCenter));
		ctx.lineTo(xToPx(oRLane), yToPx(zRLane));
		ctx.lineTo(xToPx(oROuter), yToPx(zROuter));
		ctx.stroke();

		// Lane edge markers
		ctx.strokeStyle = '#8a93a0';
		ctx.lineWidth = 1;
		ctx.setLineDash([6, 6]);
		ctx.beginPath();
		ctx.moveTo(xToPx(oLLane), yToPx(zLLane));
		ctx.lineTo(xToPx(oRLane), yToPx(zRLane));
		ctx.stroke();
		ctx.setLineDash([]);
	}
}


