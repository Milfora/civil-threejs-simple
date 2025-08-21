import * as THREE from 'three';
import { HeightFunction } from './surface';
import { RoadTemplate } from './roadway';

export interface SectionData {
	distances: number[]; // along normal, centered at 0
	elevations: number[]; // z values sampled from surface
	minZ: number;
	maxZ: number;
	centerZ: number; // elevation at alignment center (profile)
	halfWidth: number; // section half-width used for plotting
	// Daylight info (optional)
	leftEdgeOffset?: number;
	leftEdgeZ?: number;
	leftDaylightOffset?: number;
	leftDaylightZ?: number;
	rightEdgeOffset?: number;
	rightEdgeZ?: number;
	rightDaylightOffset?: number;
	rightDaylightZ?: number;
}

export class CrossSectionOverlay {
	private readonly container: HTMLDivElement;
	private readonly canvas: HTMLCanvasElement;
	private readonly ctx: CanvasRenderingContext2D;
	public active = false;
	private isDragging = false;
	private dragOffsetX = 0;
	private dragOffsetY = 0;
	private resizeObserver?: ResizeObserver;
	private lastSection?: SectionData;
	private lastTitle?: string;
	private lastTemplate?: RoadTemplate;

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
		this.setupResizeObserver();
	}

	public setActive(on: boolean) {
		this.active = on;
		this.container.classList.toggle('hidden', !on);
		if (on && this.lastSection) {
			this.draw(this.lastSection, this.lastTitle, this.lastTemplate);
		}
	}

	private setupDrag() {
		const header = this.container.querySelector('.overlay-header') as HTMLDivElement | null;
		if (!header) return;
		const closeBtn = header.querySelector('.overlay-close') as HTMLButtonElement | null;
		if (closeBtn) {
			closeBtn.addEventListener('mousedown', (e: MouseEvent) => {
				e.stopPropagation();
				e.preventDefault();
			});
			closeBtn.addEventListener('click', (e: MouseEvent) => {
				e.stopPropagation();
				this.setActive(false);
			});
		}

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
		heightFn: HeightFunction,
		profileCenterZ?: number,
		template?: RoadTemplate,
		daylightHtoV: number = 2
	): SectionData {
		// Flip sampling direction so negative offsets plot to the left side in the overlay
		const dir = perpDir.clone().multiplyScalar(-1).normalize();
		const distances: number[] = [];
		const elevations: number[] = [];
		let minZ = Number.POSITIVE_INFINITY;
		let maxZ = Number.NEGATIVE_INFINITY;
		const centerZ = (profileCenterZ !== undefined) ? profileCenterZ : heightFn(centerXY.x, centerXY.y);

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

		// Optional: compute daylight from roadway outer edges using 2H:1V, matching 3D model
		let leftEdgeOffset: number | undefined;
		let leftEdgeZ: number | undefined;
		let leftDaylightOffset: number | undefined;
		let leftDaylightZ: number | undefined;
		let rightEdgeOffset: number | undefined;
		let rightEdgeZ: number | undefined;
		let rightDaylightOffset: number | undefined;
		let rightDaylightZ: number | undefined;

		if (template) {
			const laneWidth = template.laneWidth;
			const shoulderWidth = template.shoulderWidth;
			const halfTemplate = laneWidth + shoulderWidth;
			const slopeLane = template.crossfallLane;
			const slopeShoulder = template.crossfallShoulder;
			const slopeAt = (offset: number) => (
				(Math.abs(offset) <= laneWidth ? slopeLane : slopeShoulder) * Math.sign(offset || 0)
			);

			// Left
			leftEdgeOffset = -halfTemplate;
			leftEdgeZ = centerZ + slopeAt(leftEdgeOffset) * leftEdgeOffset;
			{
				const edgeXY = new THREE.Vector2(centerXY.x + dir.x * leftEdgeOffset, centerXY.y + dir.y * leftEdgeOffset);
				const dirOut = dir.clone().multiplyScalar(-1); // further left = negative s direction
				const zSurfAtEdge = heightFn(edgeXY.x, edgeXY.y);
				const sign = Math.sign(zSurfAtEdge - leftEdgeZ) || 1; // cut(+)/fill(-)
				const dzds = sign * (1 / Math.max(1e-6, daylightHtoV));
				const dl = this.findDaylightIntersection(edgeXY, leftEdgeZ, dirOut, dzds, heightFn);
				leftDaylightOffset = leftEdgeOffset - dl.s; // moving further negative
				leftDaylightZ = dl.z;
			}

			// Right
			rightEdgeOffset = +halfTemplate;
			rightEdgeZ = centerZ + slopeAt(rightEdgeOffset) * rightEdgeOffset;
			{
				const edgeXY = new THREE.Vector2(centerXY.x + dir.x * rightEdgeOffset, centerXY.y + dir.y * rightEdgeOffset);
				const dirOut = dir.clone(); // further right = positive s direction
				const zSurfAtEdge = heightFn(edgeXY.x, edgeXY.y);
				const sign = Math.sign(zSurfAtEdge - rightEdgeZ) || 1;
				const dzds = sign * (1 / Math.max(1e-6, daylightHtoV));
				const dr = this.findDaylightIntersection(edgeXY, rightEdgeZ, dirOut, dzds, heightFn);
				rightDaylightOffset = rightEdgeOffset + dr.s;
				rightDaylightZ = dr.z;
			}
		}

		return {
			distances,
			elevations,
			minZ,
			maxZ,
			centerZ,
			halfWidth,
			leftEdgeOffset,
			leftEdgeZ,
			leftDaylightOffset,
			leftDaylightZ,
			rightEdgeOffset,
			rightEdgeZ,
			rightDaylightOffset,
			rightDaylightZ
		};
	}

	public draw(section: SectionData, title?: string, template?: RoadTemplate) {
		// Cache for redraws (e.g., on resize)
		this.lastSection = section;
		this.lastTitle = title;
		this.lastTemplate = template;
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

		// Axes scales with constant vertical exaggeration (2x) relative to horizontal scale
		const minX = section.distances[0];
		const maxX = section.distances[section.distances.length - 1];
		const xScalePxPerM = plotW / Math.max(1e-6, (maxX - minX));
		const verticalExaggeration = 2.0;
		const yScalePxPerM = verticalExaggeration * xScalePxPerM;
		const halfRangeMeters = (plotH / 2) / yScalePxPerM;
		const minYPlot = section.centerZ - halfRangeMeters;
		const maxYPlot = section.centerZ + halfRangeMeters;
		const xToPx = (x: number) => padL + ((x - minX) / (maxX - minX)) * plotW;
		const yToPx = (y: number) => {
			const dy = y - section.centerZ; // meters
			const py = (plotH / 2) - dy * yScalePxPerM; // pixels from top of plot area
			return padT + py;
		};
		const minY = minYPlot;
		const maxY = maxYPlot;
		const xToPx2 = xToPx; // keep names for following code sections
		const yToPx2 = yToPx;

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
			xToPx: xToPx2,
			yToPx: yToPx2,
			padT,
			padL,
			plotH,
			plotW,
			minX,
			maxX,
			centerZ: section.centerZ,
			template
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
			const x = xToPx2(section.distances[i]);
			const y = yToPx2(section.elevations[i]);
			if (i === 0) ctx.moveTo(x, y);
			else ctx.lineTo(x, y);
		}
		ctx.stroke();

		// Daylight slopes (2H:1V) if available
		if (
			section.leftEdgeOffset !== undefined && section.leftEdgeZ !== undefined &&
			section.leftDaylightOffset !== undefined && section.leftDaylightZ !== undefined
		) {
			ctx.strokeStyle = '#64b5f6';
			ctx.lineWidth = 2;
			ctx.beginPath();
			ctx.moveTo(xToPx2(section.leftEdgeOffset), yToPx2(section.leftEdgeZ));
			ctx.lineTo(xToPx2(section.leftDaylightOffset), yToPx2(section.leftDaylightZ));
			ctx.stroke();
		}
		if (
			section.rightEdgeOffset !== undefined && section.rightEdgeZ !== undefined &&
			section.rightDaylightOffset !== undefined && section.rightDaylightZ !== undefined
		) {
			ctx.strokeStyle = '#64b5f6';
			ctx.lineWidth = 2;
			ctx.beginPath();
			ctx.moveTo(xToPx2(section.rightEdgeOffset), yToPx2(section.rightEdgeZ));
			ctx.lineTo(xToPx2(section.rightDaylightOffset), yToPx2(section.rightDaylightZ));
			ctx.stroke();
		}
	}

	private findDaylightIntersection(
		startXY: THREE.Vector2,
		startZ: number,
		dirXY: THREE.Vector2,
		dzPerMeter: number,
		heightFn: HeightFunction
	): { x: number; y: number; z: number; s: number } {
		const maxDistance = 200;
		const step = 2;
		let s0 = 0;
		let f0 = (startZ) - heightFn(startXY.x, startXY.y);
		let s1 = step;
		let f1 = (startZ + dzPerMeter * s1) - heightFn(startXY.x + dirXY.x * s1, startXY.y + dirXY.y * s1);
		while (Math.sign(f0) === Math.sign(f1) && s1 < maxDistance) {
			s0 = s1; f0 = f1;
			s1 = Math.min(maxDistance, s1 + step);
			f1 = (startZ + dzPerMeter * s1) - heightFn(startXY.x + dirXY.x * s1, startXY.y + dirXY.y * s1);
		}
		let sStar = s1;
		if (Math.sign(f0) !== Math.sign(f1)) {
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
		template?: RoadTemplate;
	}) {
		const { ctx, xToPx, yToPx, centerZ } = args;
		const laneWidth = args.template?.laneWidth ?? 3.5;
		const shoulderWidth = args.template?.shoulderWidth ?? 1.0;
		const half = laneWidth + shoulderWidth;
		const crossfallLane = args.template?.crossfallLane ?? -0.02;
		const crossfallShoulder = args.template?.crossfallShoulder ?? -0.04;

		// Offsets
		const oLOuter = -half;
		const oLLane = -laneWidth;
		const oCenter = 0;
		const oRLane = +laneWidth;
		const oROuter = +half;

		// Match roadway.ts logic: slope depends on side and whether within lane or shoulder
		const slopeAt = (offset: number) => (
			(Math.abs(offset) <= laneWidth ? crossfallLane : crossfallShoulder) * Math.sign(offset || 0)
		);
		const zLOuter = centerZ + slopeAt(oLOuter) * oLOuter;
		const zLLane = centerZ + slopeAt(oLLane) * oLLane;
		const zCenter = centerZ;
		const zRLane = centerZ + slopeAt(oRLane) * oRLane;
		const zROuter = centerZ + slopeAt(oROuter) * oROuter;

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

	private setupResizeObserver() {
		if (!('ResizeObserver' in window)) return;
		this.resizeObserver = new ResizeObserver(() => {
			if (!this.active) return;
			if (this.lastSection) {
				this.draw(this.lastSection, this.lastTitle, this.lastTemplate);
			}
		});
		this.resizeObserver.observe(this.container);
	}
}


