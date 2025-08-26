import * as THREE from 'three';
import { theme2D } from './theme';
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
	// Pan/zoom state for plot
	private viewXMin?: number;
	private viewXMax?: number;
	private viewCenterZOffset = 0;
	private viewVEx = 2.0; // vertical exaggeration
	private isPanningPlot = false;
	private panLastX = 0;
	private panLastY = 0;
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
		this.setupInteractions();
		this.setupResizeObserver();
	}

	public setActive(on: boolean) {
		this.active = on;
		this.container.classList.toggle('hidden', !on);
		if (on && this.lastSection) {
			this.draw(this.lastSection, this.lastTitle, this.lastTemplate);
		}
	}

	private setupInteractions() {
		// Mouse wheel zoom and canvas drag to pan
		this.canvas.addEventListener('wheel', (e: WheelEvent) => {
			if (!this.active || !this.lastSection) return;
			e.preventDefault();
			const rect = this.canvas.getBoundingClientRect();
			const px = e.clientX - rect.left;
			const py = e.clientY - rect.top;
			const w = this.container.clientWidth;
			const h = this.container.clientHeight - 32;
			if (w <= 0 || h <= 0) return;
			const padL = 36, padR = 10, padT = 10, padB = 24;
			const plotW = Math.max(10, w - padL - padR);
			const plotH = Math.max(10, h - padT - padB);
			// Only act if pointer is within plot area
			if (px < padL || px > padL + plotW || py < padT || py > padT + plotH) return;
			const section = this.lastSection;
			const minXData = section.distances[0];
			const maxXData = section.distances[section.distances.length - 1];
			let xMin = this.viewXMin ?? minXData;
			let xMax = this.viewXMax ?? maxXData;
			const rangeX = Math.max(1e-6, xMax - xMin);
			const xAtCursor = xMin + ((px - padL) / plotW) * rangeX;
			// Zoom factor: positive deltaY -> zoom out
			const factor = Math.pow(1.0015, -e.deltaY);
			// Shift key: adjust vertical exaggeration instead of horizontal zoom
			if (e.shiftKey) {
				this.viewVEx = THREE.MathUtils.clamp(this.viewVEx * factor, 0.25, 20);
			} else {
				const newRange = THREE.MathUtils.clamp(rangeX / factor, 0.5, (maxXData - minXData) * 10 + 1000);
				xMin = xAtCursor - (xAtCursor - xMin) * (newRange / rangeX);
				xMax = xMin + newRange;
				this.viewXMin = xMin;
				this.viewXMax = xMax;
			}
			// Redraw
			this.draw(section, this.lastTitle, this.lastTemplate);
		}, { passive: false });

		this.canvas.addEventListener('mousedown', (e: MouseEvent) => {
			if (!this.active || !this.lastSection) return;
			// Left button to pan inside plot
			if (e.button !== 0) return;
			const rect = this.canvas.getBoundingClientRect();
			const px = e.clientX - rect.left;
			const py = e.clientY - rect.top;
			const w = this.container.clientWidth;
			const h = this.container.clientHeight - 32;
			const padL = 36, padR = 10, padT = 10, padB = 24;
			const plotW = Math.max(10, w - padL - padR);
			const plotH = Math.max(10, h - padT - padB);
			if (px < padL || px > padL + plotW || py < padT || py > padT + plotH) return;
			this.isPanningPlot = true;
			this.panLastX = px;
			this.panLastY = py;
			e.preventDefault();
		});

		window.addEventListener('mousemove', (e: MouseEvent) => {
			if (!this.isPanningPlot || !this.lastSection) return;
			const rect = this.canvas.getBoundingClientRect();
			const px = e.clientX - rect.left;
			const py = e.clientY - rect.top;
			const w = this.container.clientWidth;
			const h = this.container.clientHeight - 32;
			const padL = 36, padR = 10, padT = 10, padB = 24;
			const plotW = Math.max(10, w - padL - padR);
			const plotH = Math.max(10, h - padT - padB);
			let xMin = this.viewXMin ?? this.lastSection.distances[0];
			let xMax = this.viewXMax ?? this.lastSection.distances[this.lastSection.distances.length - 1];
			const rangeX = Math.max(1e-6, xMax - xMin);
			const metersPerPxX = rangeX / plotW;
			const xDelta = (this.panLastX - px) * metersPerPxX; // drag right moves view right
			xMin += xDelta;
			xMax += xDelta;
			this.viewXMin = xMin;
			this.viewXMax = xMax;
			// Vertical pan adjusts center Z offset
			const yScalePxPerM = this.viewVEx * (plotW / rangeX);
			const metersPerPxY = (yScalePxPerM > 1e-9) ? (1 / yScalePxPerM) : 0;
			const yDeltaMeters = (py - this.panLastY) * metersPerPxY;
			this.viewCenterZOffset += yDeltaMeters;
			this.panLastX = px;
			this.panLastY = py;
			this.draw(this.lastSection, this.lastTitle, this.lastTemplate);
		});

		window.addEventListener('mouseup', () => {
			this.isPanningPlot = false;
		});

		this.canvas.addEventListener('dblclick', () => {
			// Reset view
			this.viewXMin = undefined;
			this.viewXMax = undefined;
			this.viewCenterZOffset = 0;
			this.viewVEx = 2.0;
			if (this.lastSection) this.draw(this.lastSection, this.lastTitle, this.lastTemplate);
		});
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
			const halfTemplate = laneWidth;
			const kerbEnabled = template.components?.kerb?.enabled !== false;
			const footEnabled = template.components?.footpath?.enabled !== false;
			const kerbW = template.components?.kerb?.width ?? template.kerbWidth ?? 0.25;
			const kerbH = template.components?.kerb?.height ?? template.kerbHeight ?? 0.125;
			const footW = template.components?.footpath?.width ?? template.footpathWidth ?? 1.5;
			const xfallFoot = template.components?.footpath?.crossfall ?? template.crossfallFootpath ?? -0.02;
			const slopeAt = (offset: number) => (
				(template.crossfallLane) * Math.sign(offset || 0)
			);

			// Left footpath outer edge (or last enabled component)
			{
				const oPav = -halfTemplate;
				const zPav = centerZ + slopeAt(oPav) * oPav;
				const zKerbTop = zPav + (kerbEnabled ? kerbH : 0);
				if (footEnabled) {
					leftEdgeOffset = -(halfTemplate + (kerbEnabled ? kerbW : 0) + footW);
					leftEdgeZ = zKerbTop + (xfallFoot * -1) * footW;
				} else if (kerbEnabled) {
					leftEdgeOffset = -(halfTemplate + kerbW);
					leftEdgeZ = zKerbTop;
				} else {
					leftEdgeOffset = -halfTemplate;
					leftEdgeZ = zPav;
				}
				const edgeXY = new THREE.Vector2(centerXY.x + dir.x * leftEdgeOffset, centerXY.y + dir.y * leftEdgeOffset);
				const dirOut = dir.clone().multiplyScalar(-1);
				const zSurfAtEdge = heightFn(edgeXY.x, edgeXY.y);
				const sign = Math.sign(zSurfAtEdge - leftEdgeZ) || 1;
				const dzds = sign * (1 / Math.max(1e-6, daylightHtoV));
				const dl = this.findDaylightIntersection(edgeXY, leftEdgeZ, dirOut, dzds, heightFn);
				leftDaylightOffset = leftEdgeOffset - dl.s;
				leftDaylightZ = dl.z;
			}

			// Right footpath outer edge (or last enabled component)
			{
				const oPav = +halfTemplate;
				const zPav = centerZ + slopeAt(oPav) * oPav;
				const zKerbTop = zPav + (kerbEnabled ? kerbH : 0);
				if (footEnabled) {
					rightEdgeOffset = +(halfTemplate + (kerbEnabled ? kerbW : 0) + footW);
					rightEdgeZ = zKerbTop + (xfallFoot * +1) * footW;
				} else if (kerbEnabled) {
					rightEdgeOffset = +(halfTemplate + kerbW);
					rightEdgeZ = zKerbTop;
				} else {
					rightEdgeOffset = +halfTemplate;
					rightEdgeZ = zPav;
				}
				const edgeXY = new THREE.Vector2(centerXY.x + dir.x * rightEdgeOffset, centerXY.y + dir.y * rightEdgeOffset);
				const dirOut = dir.clone();
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

		// Axes scales with adjustable vertical exaggeration relative to horizontal scale
		const minX = this.viewXMin ?? section.distances[0];
		const maxX = this.viewXMax ?? section.distances[section.distances.length - 1];
		const xScalePxPerM = plotW / Math.max(1e-6, (maxX - minX));
		const verticalExaggeration = this.viewVEx;
		const yScalePxPerM = verticalExaggeration * xScalePxPerM;
		const halfRangeMeters = (plotH / 2) / yScalePxPerM;
		const yCenter = section.centerZ + this.viewCenterZOffset;
		const minYPlot = yCenter - halfRangeMeters;
		const maxYPlot = yCenter + halfRangeMeters;
		const xToPx = (x: number) => padL + ((x - minX) / (maxX - minX)) * plotW;
		const yToPx = (y: number) => {
			const dy = y - yCenter; // meters
			const py = (plotH / 2) - dy * yScalePxPerM; // pixels from top of plot area
			return padT + py;
		};
		const minY = minYPlot;
		const maxY = maxYPlot;
		const xToPx2 = xToPx; // keep names for following code sections
		const yToPx2 = yToPx;

		// Grid
		ctx.strokeStyle = theme2D.grid;
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
		ctx.strokeStyle = theme2D.axes;
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
			ctx.strokeStyle = theme2D.axes;
			ctx.lineWidth = 1.6;
			ctx.setLineDash([]);
			ctx.beginPath();
			ctx.moveTo(x0, padT);
			ctx.lineTo(x0, padT + plotH);
			ctx.stroke();
		}

		// Labels
		ctx.fillStyle = theme2D.labels;
		ctx.font = '11px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, Cantarell, Noto Sans';
		ctx.fillText(`${title ?? ''}`, padL + 6, padT + 14);
		ctx.fillText(`z [m]`, 6, padT + 12);
		ctx.fillText(`x⊥ [m]`, w - 42, h - 6);

		// Zero line if in range
		if (minY < 0 && maxY > 0) {
			const y0 = yToPx(0);
			ctx.strokeStyle = theme2D.grid;
			ctx.setLineDash([4, 4]);
			ctx.beginPath();
			ctx.moveTo(padL, y0);
			ctx.lineTo(padL + plotW, y0);
			ctx.stroke();
			ctx.setLineDash([]);
		}

		// Polyline
		ctx.strokeStyle = theme2D.polyline;
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
			ctx.strokeStyle = theme2D.daylight;
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
			ctx.strokeStyle = theme2D.daylight;
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
		const tpl = args.template;
		if (!tpl) return;
		const laneW = tpl.laneWidth;
		const crossfallLane = tpl.crossfallLane;
		const kerbEnabled = tpl.components?.kerb?.enabled !== false;
		const footEnabled = tpl.components?.footpath?.enabled !== false;
		const kerbW = tpl.components?.kerb?.width ?? tpl.kerbWidth ?? 0.25;
		const kerbH = tpl.components?.kerb?.height ?? tpl.kerbHeight ?? 0.125;
		const footW = tpl.components?.footpath?.width ?? tpl.footpathWidth ?? 1.5;
		const pavThk = tpl.components?.pavement?.thickness ?? tpl.pavementThickness ?? 0.3;
		const footThk = tpl.components?.footpath?.thickness ?? tpl.footpathThickness ?? 0.2;
		const xfallFoot = tpl.components?.footpath?.crossfall ?? tpl.crossfallFootpath ?? -0.02;

		const slopeAt = (offset: number) => (crossfallLane * Math.sign(offset || 0));

		// Convenience helpers
		const drawFilled = (pts: Array<[number, number]>, fill: string, stroke?: string) => {
			ctx.beginPath();
			ctx.moveTo(xToPx(pts[0][0]), yToPx(pts[0][1]));
			for (let i = 1; i < pts.length; i++) ctx.lineTo(xToPx(pts[i][0]), yToPx(pts[i][1]));
			ctx.closePath();
			ctx.fillStyle = fill;
			ctx.fill();
			if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1; ctx.stroke(); }
		};
		const drawDot = (s: number, z: number, color = '#ff8a80') => {
			const r = 3;
			ctx.beginPath();
			ctx.arc(xToPx(s), yToPx(z), r, 0, Math.PI * 2);
			ctx.fillStyle = color;
			ctx.strokeStyle = '#1b1e23';
			ctx.lineWidth = 1;
			ctx.fill();
			ctx.stroke();
		};

		// Pavement top and bottom (single slab across)
		const oL = -laneW, oC = 0, oR = +laneW;
		const zTopL = centerZ + slopeAt(oL) * oL;
		const zTopC = centerZ;
		const zTopR = centerZ + slopeAt(oR) * oR;
		const zBotL = zTopL - pavThk;
		const zBotC = zTopC - pavThk;
		const zBotR = zTopR - pavThk;
		if (tpl.components?.pavement?.enabled !== false) {
			drawFilled([
				[oL, zTopL], [oC, zTopC], [oR, zTopR],
				[oR, zBotR], [oC, zBotC], [oL, zBotL]
			], 'rgba(124, 179, 66, 0.35)', '#4d6b2a');
		}

		// Kerb (left and right) as solid above pavement
		if (kerbEnabled) {
			const zKerbInnerTopL = zTopL + kerbH;
			const zKerbOuterTopL = zKerbInnerTopL; // simple flat top
			const oKerbOuterL = -(laneW + kerbW);
			drawFilled([
				[oL, zKerbInnerTopL], [oKerbOuterL, zKerbOuterTopL],
				[oKerbOuterL, zTopL], [oL, zTopL]
			], 'rgba(255, 213, 79, 0.6)', '#b08f2a');

			const zKerbInnerTopR = zTopR + kerbH;
			const zKerbOuterTopR = zKerbInnerTopR;
			const oKerbOuterR = +(laneW + kerbW);
			drawFilled([
				[oR, zKerbInnerTopR], [oKerbOuterR, zKerbOuterTopR],
				[oKerbOuterR, zTopR], [oR, zTopR]
			], 'rgba(255, 213, 79, 0.6)', '#b08f2a');
		}

		// Footpath slabs (left/right)
		if (footEnabled) {
			const zKerbOuterTopL = zTopL + (kerbEnabled ? kerbH : 0);
			const oKerbOuterL = -(laneW + (kerbEnabled ? kerbW : 0));
			const oFootOuterL = -(laneW + (kerbEnabled ? kerbW : 0) + footW);
			const zFootInnerTopL = zKerbOuterTopL;
			const zFootOuterTopL = zKerbOuterTopL + (xfallFoot * -1) * footW;
			const zFootInnerBotL = zFootInnerTopL - footThk;
			const zFootOuterBotL = zFootOuterTopL - footThk;
			drawFilled([
				[oKerbOuterL, zFootInnerTopL], [oFootOuterL, zFootOuterTopL],
				[oFootOuterL, zFootOuterBotL], [oKerbOuterL, zFootInnerBotL]
			], 'rgba(100, 181, 246, 0.45)', '#3a6ea8');

			const zKerbOuterTopR = zTopR + (kerbEnabled ? kerbH : 0);
			const oKerbOuterR = +(laneW + (kerbEnabled ? kerbW : 0));
			const oFootOuterR = +(laneW + (kerbEnabled ? kerbW : 0) + footW);
			const zFootInnerTopR = zKerbOuterTopR;
			const zFootOuterTopR = zKerbOuterTopR + (xfallFoot * +1) * footW;
			const zFootInnerBotR = zFootInnerTopR - footThk;
			const zFootOuterBotR = zFootOuterTopR - footThk;
			drawFilled([
				[oKerbOuterR, zFootInnerTopR], [oFootOuterR, zFootOuterTopR],
				[oFootOuterR, zFootOuterBotR], [oKerbOuterR, zFootInnerBotR]
			], 'rgba(100, 181, 246, 0.45)', '#3a6ea8');
		}

		// Highlight top strings with small dots
		drawDot(oL, zTopL);
		drawDot(oR, zTopR);
		if (kerbEnabled) {
			const oKerbOuterL = -(laneW + kerbW);
			const oKerbOuterR = +(laneW + kerbW);
			const zKerbOuterTopL = zTopL + kerbH;
			const zKerbOuterTopR = zTopR + kerbH;
			drawDot(oKerbOuterL, zKerbOuterTopL);
			drawDot(oKerbOuterR, zKerbOuterTopR);
		}
		if (footEnabled) {
			const oFootOuterL = -(laneW + (kerbEnabled ? kerbW : 0) + footW);
			const oFootOuterR = +(laneW + (kerbEnabled ? kerbW : 0) + footW);
			const zKerbOuterTopL = zTopL + (kerbEnabled ? kerbH : 0);
			const zKerbOuterTopR = zTopR + (kerbEnabled ? kerbH : 0);
			const zFootOuterTopL = zKerbOuterTopL + (xfallFoot * -1) * footW;
			const zFootOuterTopR = zKerbOuterTopR + (xfallFoot * +1) * footW;
			drawDot(oFootOuterL, zFootOuterTopL);
			drawDot(oFootOuterR, zFootOuterTopR);
		}
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


